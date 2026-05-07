// GET/POST /api/proposals/[id]/revisions — git-like revision history for sandbox graph.

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { internalApiError } from '@/lib/apiError';
import { buildNetworkElementCreateData, isNetworkElementType } from '@/lib/stage7/networkElementOps';
import { canCommitProposalGraphRevision } from '@/lib/stage7/proposalMutationPolicy';
import { replaceProposalChangeActionsWithCreatesInTx } from '@/lib/stage7/replaceProposalSandboxCreates';
import {
  computeSnapshotDiffSummary,
  ensureProposalRevisionBaseline,
  type SnapshotElementPayload,
} from '@/lib/stage7/proposalRevisionSnapshot';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';
import { isPinnedGraphSupereditAuthor } from '@/lib/stage7/pinnedGraphSupereditAuthors';

type Params = { params: Promise<{ id: string }> };

type PostBody = {
  signature?: string;
  /** Optimistic lock: id текущей head-ревизии; null/omit только если до коммита не было headRevisionId. */
  baseRevisionId?: string | null;
  message?: string;
  creates?: unknown[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const clientIp = getClientIp(_req);
  if (!(await checkRateLimit(`proposals.revisions.list:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const p = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const rows = await prisma.proposalRevision.findMany({
    where: { proposalId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      parentRevisionId: true,
      authorPubkey: true,
      message: true,
      diffSummary: true,
      isBaseline: true,
      createdAt: true,
    },
  });

  return NextResponse.json(rows, { status: 200, headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const tooBig = assertBodySizeWithin(req, 500_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.revisions.post:${clientIp}`, 40, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const signature = typeof body.signature === 'string' ? body.signature : '';
  const creates = body.creates;
  const messageRaw = typeof body.message === 'string' ? body.message.trim() : '';
  const baseRevisionId =
    typeof body.baseRevisionId === 'string' && body.baseRevisionId.trim()
      ? body.baseRevisionId.trim()
      : body.baseRevisionId === null || typeof body.baseRevisionId === 'undefined'
        ? null
        : null;

  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  if (!messageRaw || messageRaw.length > 2000) {
    return NextResponse.json({ error: 'message required (max 2000 chars)' }, { status: 400 });
  }
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
      headRevisionId: true,
      pinned: true,
    },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const voteCount = await prisma.vote.count({ where: { proposalId: id } });
  const pinnedGraphSuperedit =
    proposal.pinned && (await isPinnedGraphSupereditAuthor(proposal.authorPubkey));
  if (
    !canCommitProposalGraphRevision({
      status: proposal.status,
      voteCount,
      onChainTxSignature: proposal.onChainTxSignature,
      pinnedGraphSuperedit,
    })
  ) {
    return NextResponse.json(
      { error: 'revision commit not allowed for this proposal; use fork', code: 'revision_commit_forbidden' },
      { status: 409 },
    );
  }

  const expectedMessage = `diploma-z96a propose:revision:${id}:${baseRevisionId ?? 'null'}`;
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
    const result = await prisma.$transaction(async (tx) => {
      const headBeforeEnsure = (
        await tx.proposal.findUnique({
          where: { id },
          select: { headRevisionId: true },
        })
      )?.headRevisionId;

      await ensureProposalRevisionBaseline(tx, id, proposal.authorPubkey);

      const p2 = await tx.proposal.findUnique({
        where: { id },
        select: { headRevisionId: true },
      });
      const currentHead = p2?.headRevisionId;
      if (!currentHead) throw new Error('headRevision missing after baseline');

      const baseOk =
        (baseRevisionId == null && headBeforeEnsure == null) ||
        (baseRevisionId != null && baseRevisionId === currentHead);
      if (!baseOk) {
        const err = new Error('revision_conflict');
        (err as Error & { status?: number }).status = 409;
        throw err;
      }

      const parentRow = await tx.proposalRevision.findUnique({
        where: { id: currentHead },
        select: { snapshot: true },
      });
      const parentSnap = (parentRow?.snapshot ?? []) as unknown as SnapshotElementPayload[];
      const diffSummary = computeSnapshotDiffSummary(parentSnap, payloads as SnapshotElementPayload[]);

      const newRevId = randomUUID();
      await tx.proposalRevision.create({
        data: {
          id: newRevId,
          proposalId: id,
          parentRevisionId: currentHead,
          authorPubkey: proposal.authorPubkey,
          message: messageRaw,
          snapshot: payloads as unknown as Prisma.InputJsonValue,
          diffSummary: diffSummary as unknown as Prisma.InputJsonValue,
          isBaseline: false,
        },
      });

      await tx.proposal.update({
        where: { id },
        data: { headRevisionId: newRevId },
      });

      await replaceProposalChangeActionsWithCreatesInTx(tx, {
        proposalId: id,
        scope: proposal.scope,
        title: proposal.title,
        description: proposal.description,
        status: proposal.status,
        payloads,
      });

      return { revisionId: newRevId, headRevisionId: newRevId };
    });

    return NextResponse.json(
      { ok: true, ...result },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'revision_conflict') {
      return NextResponse.json(
        { error: 'revision conflict', code: 'revision_conflict' },
        { status: 409 },
      );
    }
    console.error('proposal revisions POST failed', e);
    return internalApiError('failed to save revision', 500);
  }
}
