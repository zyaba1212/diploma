// HTTP API /api/proposals/[id]/apply — Next.js Route Handler.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as nodeCrypto from 'node:crypto';
import type { Prisma, ProposalStatus } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { ensureHistoryEntryTable, insertHistoryEntry } from '@/lib/stage7/historyStore';
import {
  buildNetworkElementCreateData,
  buildNetworkElementUpdateData,
  isNetworkElementType,
  snapshotFromNetworkElement,
} from '@/lib/stage7/networkElementOps';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { logApiMetric } from '@/lib/apiOps';
import { internalApiError } from '@/lib/apiError';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';

type Params = {
  params: Promise<{ id: string }>;
};

type Body = {
  signature?: string;
};

type ChangeActionDiff =
  | { kind: 'CREATE'; createdElementId: string }
  | { kind: 'UPDATE'; targetElementId: string; beforeElement: unknown }
  | { kind: 'DELETE'; targetElementId: string; deletedElement: unknown };

function isKnownStatus(value: unknown): value is ProposalStatus {
  return value === 'DRAFT' || value === 'SUBMITTED' || value === 'ACCEPTED' || value === 'REJECTED';
}

function randomId() {
  // If Node supports randomUUID (usually does), prefer it. Otherwise fallback to bytes.
  return typeof nodeCrypto.randomUUID === 'function'
    ? nodeCrypto.randomUUID()
    : nodeCrypto.randomBytes(16).toString('hex');
}

function buildDiffForActionCreate(createdElementId: string): ChangeActionDiff {
  return { kind: 'CREATE', createdElementId };
}
function buildDiffForActionUpdate(targetElementId: string, beforeElement: unknown): ChangeActionDiff {
  return { kind: 'UPDATE', targetElementId, beforeElement };
}
function buildDiffForActionDelete(targetElementId: string, deletedElement: unknown): ChangeActionDiff {
  return { kind: 'DELETE', targetElementId, deletedElement };
}

export async function POST(req: Request, { params }: Params) {
  const started = Date.now();
  const tooBig = assertBodySizeWithin(req, 200_000);
  if (tooBig) return tooBig;
  const { id: proposalId } = await params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const signature = typeof body.signature === 'string' ? body.signature : '';

  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, status: true, scope: true, authorPubkey: true, contentHash: true },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!isKnownStatus(proposal.status)) return NextResponse.json({ error: 'invalid proposal status' }, { status: 409 });

  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  // Signature check: author signs `diploma-z96a propose:apply:<proposalId>:<contentHash>`.
  if (!proposal.contentHash) {
    return NextResponse.json({ error: 'missing proposal contentHash' }, { status: 400 });
  }
  const expectedMessage = `diploma-z96a propose:apply:${proposalId}:${proposal.contentHash}`;
  let sigBytes: Uint8Array;
  let pkBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
    pkBytes = bs58.decode(proposal.authorPubkey);
  } catch {
    return NextResponse.json({ error: 'invalid base58 signature or pubkey' }, { status: 400 });
  }
  const msgBytes = new TextEncoder().encode(expectedMessage);
  const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
  if (!ok) {
    return NextResponse.json({ error: 'signature invalid' }, { status: 401 });
  }

  if (await isUserBanned(proposal.authorPubkey)) {
    return userBannedResponsePlain();
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.apply:${clientIp}`, 10, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const allowProduction = proposal.status === 'ACCEPTED';
  if (!allowProduction) {
    // Dev convenience: allow apply from SUBMITTED so Stage 7 can be tested even before decide flow.
    if (process.env.NODE_ENV === 'production' || proposal.status !== 'SUBMITTED') {
      return NextResponse.json({ error: 'proposal must be ACCEPTED' }, { status: 409 });
    }
  }

  const actions = await prisma.changeAction.findMany({
    where: { proposalId: proposal.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, actionType: true, targetElementId: true, elementPayload: true },
  });

  if (!actions.length) {
    return NextResponse.json({ error: 'no actions to apply' }, { status: 400 });
  }

  if (actions.length > 50) {
    return NextResponse.json({ error: 'too many actions to apply' }, { status: 400 });
  }

  let latestHistoryId: string | null = null;

  try {
    // Apply is a multi-step operation: network changes + HistoryEntry insert.
    await prisma.$transaction(async (tx) => {
      await ensureHistoryEntryTable(tx);

      for (const action of actions) {
        if (action.actionType === 'CREATE') {
          // Validate elementPayload shape and build NetworkElement creation data.
          let createData;
          try {
            createData = buildNetworkElementCreateData({
              proposalScope: proposal.scope,
              payload: action.elementPayload,
            });
          } catch {
            throw new ApiError(400, 'invalid elementPayload for CREATE');
          }

          const created = await tx.networkElement.create({
            data: createData as Prisma.NetworkElementUncheckedCreateInput,
          });

          const historyId = randomId();
          const diff: ChangeActionDiff = buildDiffForActionCreate(created.id);
          await insertHistoryEntry(tx, {
            id: historyId,
            proposalId: proposal.id,
            actionId: action.id,
            diff,
          });
          latestHistoryId = historyId;
          continue;
        }

        if (action.actionType === 'UPDATE') {
          const targetElementId = action.targetElementId;
          if (!targetElementId) {
            throw new ApiError(400, 'targetElementId required for UPDATE');
          }
          const before = await tx.networkElement.findUnique({
            where: { id: targetElementId },
          });
          if (!before) {
            throw new ApiError(400, 'target element not found');
          }

          const beforeSnapshot = snapshotFromNetworkElement(before);

          // If user provided `type` explicitly, validate it.
          const explicitType = (action.elementPayload as any)?.type;
          if (typeof explicitType !== 'undefined' && !isNetworkElementType(explicitType)) {
            throw new ApiError(400, 'invalid elementPayload.type');
          }

          const updateData = buildNetworkElementUpdateData(action.elementPayload);
          if (Object.keys(updateData).length === 0) {
            throw new ApiError(400, 'empty elementPayload for UPDATE');
          }

          await tx.networkElement.update({
            where: { id: targetElementId },
            data: updateData as Prisma.NetworkElementUncheckedUpdateInput,
          });

          const diff: ChangeActionDiff = buildDiffForActionUpdate(targetElementId, beforeSnapshot);
          const historyId = randomId();
          await insertHistoryEntry(tx, {
            id: historyId,
            proposalId: proposal.id,
            actionId: action.id,
            diff,
          });
          latestHistoryId = historyId;
          continue;
        }

        if (action.actionType === 'DELETE') {
          const targetElementId = action.targetElementId;
          if (!targetElementId) {
            throw new ApiError(400, 'targetElementId required for DELETE');
          }
          const before = await tx.networkElement.findUnique({
            where: { id: targetElementId },
          });
          if (!before) {
            throw new ApiError(400, 'target element not found');
          }

          const beforeSnapshot = snapshotFromNetworkElement(before);
          await tx.networkElement.delete({ where: { id: targetElementId } });

          const diff: ChangeActionDiff = buildDiffForActionDelete(targetElementId, beforeSnapshot);
          const historyId = randomId();
          await insertHistoryEntry(tx, {
            id: historyId,
            proposalId: proposal.id,
            actionId: action.id,
            diff,
          });
          latestHistoryId = historyId;
          continue;
        }

        throw new ApiError(400, 'unknown actionType');
      }
    });

    // Stage 7 UI expects APPLIED to enable rollback.
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'APPLIED' },
    });

    if (!latestHistoryId) {
      throw new ApiError(500, 'historyId not produced');
    }

    logApiMetric({
      route: '/api/proposals/:id/apply',
      method: 'POST',
      status: 200,
      durationMs: Date.now() - started,
      ok: true,
    });
    return NextResponse.json({ ok: true, historyId: latestHistoryId }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof ApiError) {
      logApiMetric({
        route: '/api/proposals/:id/apply',
        method: 'POST',
        status: err.status,
        durationMs: Date.now() - started,
        ok: false,
        note: err.message,
      });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Non-ApiError exceptions: log the real error for debugging (Stage 7/8 smoke).
    // Note: we intentionally do not leak stack traces to the client.
    console.error('apply failed (unexpected)', err);
    logApiMetric({
      route: '/api/proposals/:id/apply',
      method: 'POST',
      status: 500,
      durationMs: Date.now() - started,
      ok: false,
      note: 'apply_failed',
    });
    return internalApiError('apply failed', 500);
  }
}

