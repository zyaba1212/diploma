// HTTP API /api/proposals/[id]/sync-actions — Next.js Route Handler.
// Replaces all ChangeAction rows with CREATE actions from the sandbox (signed by author).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { internalApiError } from '@/lib/apiError';
import { buildNetworkElementCreateData, isNetworkElementType } from '@/lib/stage7/networkElementOps';
import { canReplaceActionsViaSandboxSync } from '@/lib/stage7/proposalMutationPolicy';
import { computeProposalContentHashHexFromDbActions } from '@/lib/stage7/proposalContentHashServer';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';

type Params = { params: Promise<{ id: string }> };

type Body = {
  signature?: string;
  creates?: unknown[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const tooBig = assertBodySizeWithin(req, 500_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.syncActions:${clientIp}`, 40, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const signature = typeof body.signature === 'string' ? body.signature : '';
  const creates = body.creates;
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  if (!Array.isArray(creates)) return NextResponse.json({ error: 'creates must be an array' }, { status: 400 });

  const totalBytes = Buffer.byteLength(JSON.stringify(creates));
  if (totalBytes > 400_000) {
    return NextResponse.json({ error: 'creates payload too large' }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      authorPubkey: true,
      scope: true,
      title: true,
      description: true,
      onChainTxSignature: true,
    },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const voteCount = await prisma.vote.count({ where: { proposalId: id } });
  if (
    !canReplaceActionsViaSandboxSync({
      status: proposal.status,
      voteCount,
      onChainTxSignature: proposal.onChainTxSignature,
    })
  ) {
    return NextResponse.json(
      { error: 'sync-actions not allowed for this proposal status or state' },
      { status: 409 },
    );
  }

  const expectedMessage = `diploma-z96a propose:sync-actions:${id}`;
  let sigBytes: Uint8Array;
  let pkBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
    pkBytes = bs58.decode(proposal.authorPubkey);
  } catch {
    return NextResponse.json({ error: 'invalid base58 signature or pubkey' }, { status: 400 });
  }
  const msgBytes = new TextEncoder().encode(expectedMessage);
  if (!nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes)) {
    return NextResponse.json({ error: 'signature invalid' }, { status: 401 });
  }

  if (await isUserBanned(proposal.authorPubkey)) {
    return userBannedResponsePlain();
  }

  const payloads: Prisma.InputJsonObject[] = [];
  for (const item of creates) {
    if (!isPlainObject(item)) {
      return NextResponse.json({ error: 'each create must be an object (elementPayload)' }, { status: 400 });
    }
    const pb = Buffer.byteLength(JSON.stringify(item));
    if (pb > 50_000) return NextResponse.json({ error: 'elementPayload too large' }, { status: 400 });
    const maybeType = item.type;
    if (typeof maybeType !== 'undefined' && !isNetworkElementType(maybeType)) {
      return NextResponse.json({ error: 'invalid elementPayload.type' }, { status: 400 });
    }
    try {
      buildNetworkElementCreateData({ proposalScope: proposal.scope, payload: item });
    } catch {
      return NextResponse.json({ error: 'invalid elementPayload for CREATE' }, { status: 400 });
    }
    payloads.push(item as Prisma.InputJsonObject);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.changeAction.deleteMany({ where: { proposalId: id } });
      for (const elementPayload of payloads) {
        await tx.changeAction.create({
          data: {
            proposalId: id,
            actionType: 'CREATE',
            targetElementId: null,
            elementPayload,
          },
        });
      }

      if (proposal.status === 'SUBMITTED') {
        const actions = await tx.changeAction.findMany({
          where: { proposalId: id },
          orderBy: { createdAt: 'asc' },
          select: { actionType: true, targetElementId: true, elementPayload: true },
        });
        const newHash = computeProposalContentHashHexFromDbActions({
          scope: proposal.scope,
          title: proposal.title,
          description: proposal.description,
          actions,
        });
        await tx.proposal.update({
          where: { id },
          data: { contentHash: newHash },
        });
      }
    });

    return NextResponse.json(
      { ok: true, count: payloads.length },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('sync-actions failed', e);
    return internalApiError('failed to sync actions', 500);
  }
}
