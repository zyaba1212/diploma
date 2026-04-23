// HTTP API /api/proposals/[id] — Next.js Route Handler.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProposalStatus } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { canPatchProposalMetadata } from '@/lib/stage7/proposalMutationPolicy';
import { computeProposalContentHashHexFromDbActions } from '@/lib/stage7/proposalContentHashServer';
import { internalApiError } from '@/lib/apiError';
import { hardDeleteProposalInTransaction } from '@/lib/proposals/hardDeleteProposalInTransaction';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';

type Params = {
  params: Promise<{
    id: string;
  }>;
};

const BLOCKED_DELETE_STATUSES: ProposalStatus[] = ['ACCEPTED', 'APPLIED'];

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: {
        actions: {
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { votes: true },
        },
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    return NextResponse.json(proposal, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('Failed to get proposal', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

type DeleteBody = {
  authorPubkey?: string;
  signature?: string;
};

type PatchBody = {
  authorPubkey?: string;
  signature?: string;
  title?: string | null;
  description?: string | null;
};

export async function PATCH(req: Request, { params }: Params) {
  const tooBig = assertBodySizeWithin(req, 50_000);
  if (tooBig) return tooBig;
  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.patch:${clientIp}`, 40, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const authorPubkey = typeof body.authorPubkey === 'string' ? body.authorPubkey.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!authorPubkey) return NextResponse.json({ error: 'authorPubkey required' }, { status: 400 });
  if (!signature) return NextResponse.json({ error: 'signature required' }, { status: 400 });

  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
  if (!hasTitle && !hasDescription) {
    return NextResponse.json({ error: 'title or description required' }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      authorPubkey: true,
      title: true,
      description: true,
      onChainTxSignature: true,
    },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (proposal.authorPubkey !== authorPubkey) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const voteCount = await prisma.vote.count({ where: { proposalId: id } });
  if (
    !canPatchProposalMetadata({
      status: proposal.status,
      voteCount,
      onChainTxSignature: proposal.onChainTxSignature,
    })
  ) {
    return NextResponse.json(
      { error: 'metadata patch not allowed for this proposal status or state' },
      { status: 409 },
    );
  }

  const expectedMessage = `diploma-z96a propose:patch-metadata:${id}`;
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

  const titleNext = hasTitle
    ? typeof body.title === 'string'
      ? body.title.trim() || null
      : body.title === null
        ? null
        : undefined
    : undefined;
  const descriptionNext = hasDescription
    ? typeof body.description === 'string'
      ? body.description.trim() || null
      : body.description === null
        ? null
        : undefined
    : undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const data: { title?: string | null; description?: string | null } = {};
      if (titleNext !== undefined) data.title = titleNext;
      if (descriptionNext !== undefined) data.description = descriptionNext;
      await tx.proposal.update({ where: { id }, data });

      if (proposal.status === 'SUBMITTED') {
        const full = await tx.proposal.findUnique({
          where: { id },
          select: {
            scope: true,
            title: true,
            description: true,
            actions: {
              orderBy: { createdAt: 'asc' },
              select: { actionType: true, targetElementId: true, elementPayload: true },
            },
          },
        });
        if (!full) throw new Error('proposal missing');
        const newHash = computeProposalContentHashHexFromDbActions({
          scope: full.scope,
          title: full.title,
          description: full.description,
          actions: full.actions,
        });
        await tx.proposal.update({
          where: { id },
          data: { contentHash: newHash },
        });
      }
    });

    const row = await prisma.proposal.findUnique({
      where: { id },
      select: { id: true, title: true, description: true, contentHash: true, status: true },
    });

    return NextResponse.json({ ok: true, proposal: row }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('Failed to patch proposal', err);
    return internalApiError('failed to patch proposal', 500);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const tooBig = assertBodySizeWithin(req, 10_000);
  if (tooBig) return tooBig;

  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.delete:${clientIp}`, 20, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const authorPubkey = typeof body.authorPubkey === 'string' ? body.authorPubkey.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!authorPubkey) return NextResponse.json({ error: 'authorPubkey required' }, { status: 400 });
  if (!signature) return NextResponse.json({ error: 'signature required' }, { status: 400 });

  const expectedMessage = `diploma-z96a propose:delete:${id}`;
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

  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      select: { id: true, authorPubkey: true, status: true },
    });

    if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (proposal.authorPubkey !== authorPubkey) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (BLOCKED_DELETE_STATUSES.includes(proposal.status)) {
      return NextResponse.json({ error: 'cannot delete proposal in this status' }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      await hardDeleteProposalInTransaction(tx, id);
    });

    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('Failed to delete proposal', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
