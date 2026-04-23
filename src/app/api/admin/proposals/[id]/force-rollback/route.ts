import { NextResponse } from 'next/server';

import type { Prisma } from '@prisma/client';

import { requireStaff } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { internalApiError } from '@/lib/apiError';
import { logApiMetric } from '@/lib/apiOps';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { deleteHistoryEntry, ensureHistoryEntryTable, getLatestHistoryEntry } from '@/lib/stage7/historyStore';
import type { NetworkElementSnapshot } from '@/lib/stage7/networkElementOps';

type RouteContext = { params: Promise<{ id: string }> };

function isKnownDiffKind(v: unknown): v is 'CREATE' | 'UPDATE' | 'DELETE' {
  return v === 'CREATE' || v === 'UPDATE' || v === 'DELETE';
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Stage 13 — принудительный rollback APPLIED/ACCEPTED предложения без подписи автора.
 * Выполняется staff-сессией (ADMIN или MODERATOR); каждое действие пишется в `AuditLog`.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const started = Date.now();
  const tooBig = assertBodySizeWithin(req, 8_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.proposals.force_rollback:${clientIp}`, 10, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const { id: proposalId } = await ctx.params;

  let reason: string | null = null;
  try {
    const body = (await req.json()) as { reason?: string } | null;
    if (body && typeof body.reason === 'string') {
      reason = body.reason.trim().slice(0, 500) || null;
    }
  } catch {
    // no body is fine
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, status: true, title: true },
  });
  if (!proposal) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (proposal.status !== 'APPLIED' && proposal.status !== 'ACCEPTED') {
    return NextResponse.json(
      { error: 'proposal must be APPLIED or ACCEPTED' },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }

  const latest = await getLatestHistoryEntry(prisma, proposalId);
  if (!latest) {
    await recordAuditEvent({
      session,
      action: AuditAction.ProposalForceRollback,
      targetType: 'Proposal',
      targetId: proposalId,
      meta: { title: proposal.title, reason, error: 'no_history' },
    });
    return NextResponse.json({ error: 'no history to rollback' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const diff = latest.diff;
  const parsed = typeof diff === 'string' ? safeJsonParse(diff) : diff;
  if (!parsed || typeof parsed !== 'object') {
    return NextResponse.json({ error: 'invalid history diff' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const diffObj = parsed as Record<string, unknown>;
  const kind = diffObj.kind;
  if (!isKnownDiffKind(kind)) {
    return NextResponse.json({ error: 'invalid history diff kind' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await ensureHistoryEntryTable(tx);

      if (kind === 'CREATE') {
        const createdElementId = diffObj.createdElementId;
        if (typeof createdElementId !== 'string') throw new Error('invalid createdElementId in diff');
        await tx.networkElement.deleteMany({ where: { id: createdElementId } });
      } else if (kind === 'UPDATE') {
        const beforeElement = diffObj.beforeElement as NetworkElementSnapshot | undefined;
        if (!beforeElement || typeof beforeElement.id !== 'string') {
          throw new Error('invalid beforeElement in diff');
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
        const deletedElement = diffObj.deletedElement as NetworkElementSnapshot | undefined;
        if (!deletedElement || typeof deletedElement.id !== 'string') {
          throw new Error('invalid deletedElement in diff');
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

    await recordAuditEvent({
      session,
      action: AuditAction.ProposalForceRollback,
      targetType: 'Proposal',
      targetId: proposalId,
      meta: {
        title: proposal.title,
        reason,
        rolledBackHistoryId: latest.id,
        diffKind: kind,
      },
    });

    logApiMetric({
      route: '/api/admin/proposals/:id/force-rollback',
      method: 'POST',
      status: 200,
      durationMs: Date.now() - started,
      ok: true,
    });
    return NextResponse.json(
      { ok: true, historyId: latest.id },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[admin.proposals.force_rollback] failed', err);
    await recordAuditEvent({
      session,
      action: AuditAction.ProposalForceRollback,
      targetType: 'Proposal',
      targetId: proposalId,
      meta: { title: proposal.title, reason, error: (err as Error).message },
    });
    logApiMetric({
      route: '/api/admin/proposals/:id/force-rollback',
      method: 'POST',
      status: 500,
      durationMs: Date.now() - started,
      ok: false,
      note: 'rollback_failed',
    });
    return internalApiError('rollback failed', 500);
  }
}
