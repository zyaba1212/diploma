// POST /api/proposals/[id]/fork — новое предложение из текущего состояния песочницы.

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { internalApiError } from '@/lib/apiError';
import { buildNetworkElementCreateData, isNetworkElementType } from '@/lib/stage7/networkElementOps';
import { replaceProposalChangeActionsWithCreatesInTx } from '@/lib/stage7/replaceProposalSandboxCreates';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';
import { pubkeyHasPinnedNetworkCuratorUsername } from '@/lib/stage7/pinnedGraphSupereditAuthors';

type Params = { params: Promise<{ id: string }> };

type Body = {
  authorPubkey?: string;
  signature?: string;
  title?: string;
  description?: string;
  message?: string;
  creates?: unknown[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function POST(req: Request, { params }: Params) {
  const { id: sourceId } = await params;
  const tooBig = assertBodySizeWithin(req, 500_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.fork:${clientIp}`, 20, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const authorPubkey = typeof body.authorPubkey === 'string' ? body.authorPubkey.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const messageRaw = typeof body.message === 'string' ? body.message.trim() : '';
  const creates = body.creates;

  if (!authorPubkey) return NextResponse.json({ error: 'authorPubkey required' }, { status: 400 });
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (!messageRaw || messageRaw.length > 2000) {
    return NextResponse.json({ error: 'message required (max 2000 chars)' }, { status: 400 });
  }
  if (!Array.isArray(creates)) return NextResponse.json({ error: 'creates must be an array' }, { status: 400 });

  const totalBytes = Buffer.byteLength(JSON.stringify(creates));
  if (totalBytes > 400_000) {
    return NextResponse.json({ error: 'creates payload too large' }, { status: 400 });
  }

  const source = await prisma.proposal.findUnique({
    where: { id: sourceId },
    select: { id: true, authorPubkey: true, scope: true, pinned: true },
  });
  if (!source) return NextResponse.json({ error: 'source proposal not found' }, { status: 404 });
  const curatorMayForkPinned =
    Boolean(source.pinned) && (await pubkeyHasPinnedNetworkCuratorUsername(authorPubkey));
  if (source.authorPubkey !== authorPubkey && !curatorMayForkPinned) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const expectedMessage = `diploma-z96a propose:fork:${sourceId}`;
  let sigBytes: Uint8Array;
  let pkBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
    pkBytes = bs58.decode(authorPubkey);
  } catch {
    return NextResponse.json({ error: 'invalid base58 signature or pubkey' }, { status: 400 });
  }
  const msgBytes = new TextEncoder().encode(expectedMessage);
  if (!nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes)) {
    return NextResponse.json({ error: 'signature invalid' }, { status: 401 });
  }

  if (await isUserBanned(authorPubkey)) {
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
      buildNetworkElementCreateData({ proposalScope: source.scope, payload: item });
    } catch {
      return NextResponse.json({ error: 'invalid elementPayload for CREATE' }, { status: 400 });
    }
    payloads.push(item as Prisma.InputJsonObject);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const np = await tx.proposal.create({
        data: {
          scope: source.scope,
          authorPubkey,
          status: 'DRAFT',
          title,
          description: description || null,
          forkedFromProposalId: source.id,
        },
        select: { id: true },
      });

      await replaceProposalChangeActionsWithCreatesInTx(tx, {
        proposalId: np.id,
        scope: source.scope,
        title,
        description: description || null,
        status: 'DRAFT',
        payloads,
      });

      const revId = randomUUID();
      await tx.proposalRevision.create({
        data: {
          id: revId,
          proposalId: np.id,
          parentRevisionId: null,
          authorPubkey,
          message: messageRaw,
          snapshot: payloads as unknown as Prisma.InputJsonValue,
          diffSummary: { added: payloads.length, removed: 0, changed: 0 } as unknown as Prisma.InputJsonValue,
          isBaseline: true,
        },
      });

      await tx.proposal.update({
        where: { id: np.id },
        data: { headRevisionId: revId },
      });

      return { id: np.id, headRevisionId: revId };
    });

    return NextResponse.json(
      { ok: true, proposal: created },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('proposal fork failed', e);
    return internalApiError('failed to fork proposal', 500);
  }
}
