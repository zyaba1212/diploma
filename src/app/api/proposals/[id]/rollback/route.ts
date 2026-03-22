import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteHistoryEntry, ensureHistoryEntryTable, getLatestHistoryEntry } from '@/lib/stage7/historyStore';
import type { Prisma } from '@prisma/client';
import type { NetworkElementSnapshot } from '@/lib/stage7/networkElementOps';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { logApiMetric } from '@/lib/apiOps';
import { internalApiError } from '@/lib/apiError';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';

type Params = {
  params: Promise<{ id: string }>;
};

type Body = {
  signature?: string;
};

function isKnownDiffKind(v: unknown): v is 'CREATE' | 'UPDATE' | 'DELETE' {
  return v === 'CREATE' || v === 'UPDATE' || v === 'DELETE';
}

export async function POST(req: Request, { params }: Params) {
  const started = Date.now();
  const tooBig = assertBodySizeWithin(req, 50_000);
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
    select: { id: true, status: true, authorPubkey: true },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.rollback:${clientIp}`, 10, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  if (process.env.NODE_ENV === 'production') {
    if (proposal.status !== 'APPLIED') {
      return NextResponse.json({ error: 'proposal must be APPLIED' }, { status: 409 });
    }
  }

  const latest = await getLatestHistoryEntry(prisma, proposalId);
  if (!latest) {
    return NextResponse.json({ error: 'no history to rollback' }, { status: 404 });
  }

  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  // Signature check: author signs `diploma-z96a propose:rollback:<proposalId>:<historyId>`.
  const expectedMessage = `diploma-z96a propose:rollback:${proposalId}:${latest.id}`;
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

  const diff = latest.diff;
  const parsed = typeof diff === 'string' ? safeJsonParse(diff) : diff;
  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json({ error: 'invalid history diff' }, { status: 400 });
  }

  const kind = (parsed as any).kind;
  if (!isKnownDiffKind(kind)) {
    return NextResponse.json({ error: 'invalid history diff kind' }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await ensureHistoryEntryTable(tx);

      if (kind === 'CREATE') {
        const createdElementId = (parsed as any).createdElementId;
        if (typeof createdElementId !== 'string') throw new ApiError(500, 'invalid createdElementId in diff');
        await tx.networkElement.deleteMany({ where: { id: createdElementId } });
      } else if (kind === 'UPDATE') {
        const beforeElement = (parsed as any).beforeElement as NetworkElementSnapshot | undefined;
        if (!beforeElement || typeof beforeElement.id !== 'string') {
          throw new ApiError(500, 'invalid beforeElement in diff');
        }
        await tx.networkElement.update({
          where: { id: beforeElement.id },
          data: {
            scope: beforeElement.scope,
            type: beforeElement.type,
            providerId: beforeElement.providerId,
            name: beforeElement.name,
            sourceId: beforeElement.sourceId,
            lat: beforeElement.lat,
            lng: beforeElement.lng,
            altitude: beforeElement.altitude,
            path: beforeElement.path,
            metadata: beforeElement.metadata,
          } as Prisma.NetworkElementUncheckedUpdateInput,
        });
      } else if (kind === 'DELETE') {
        const deletedElement = (parsed as any).deletedElement as NetworkElementSnapshot | undefined;
        if (!deletedElement || typeof deletedElement.id !== 'string') {
          throw new ApiError(500, 'invalid deletedElement in diff');
        }
        await tx.networkElement.create({
          data: {
            id: deletedElement.id,
            scope: deletedElement.scope,
            type: deletedElement.type,
            providerId: deletedElement.providerId,
            name: deletedElement.name,
            sourceId: deletedElement.sourceId,
            lat: deletedElement.lat,
            lng: deletedElement.lng,
            altitude: deletedElement.altitude,
            path: deletedElement.path,
            metadata: deletedElement.metadata,
          } as Prisma.NetworkElementUncheckedCreateInput,
        });
      }

      await deleteHistoryEntry(tx, latest.id);

      const remainingLatest = await getLatestHistoryEntry(tx, proposalId);
      await tx.proposal.update({
        where: { id: proposalId },
        data: { status: remainingLatest ? 'APPLIED' : 'ACCEPTED' },
      });
    });

    logApiMetric({
      route: '/api/proposals/:id/rollback',
      method: 'POST',
      status: 200,
      durationMs: Date.now() - started,
      ok: true,
    });
    return NextResponse.json({ ok: true, historyId: latest.id });
  } catch (err) {
    if (err instanceof ApiError) {
      logApiMetric({
        route: '/api/proposals/:id/rollback',
        method: 'POST',
        status: err.status,
        durationMs: Date.now() - started,
        ok: false,
        note: err.message,
      });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logApiMetric({
      route: '/api/proposals/:id/rollback',
      method: 'POST',
      status: 500,
      durationMs: Date.now() - started,
      ok: false,
      note: 'rollback_failed',
    });
    return internalApiError('rollback failed', 500);
  }
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

