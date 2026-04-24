import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { prisma } from '@/lib/prisma';
import { hardDeleteProposalInTransaction } from '@/lib/proposals/hardDeleteProposalInTransaction';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

type RouteContext = { params: Promise<{ id: string }> };
type Body = {
  pinned?: boolean;
  cancelReason?: string | null;
};

export async function GET(req: Request, ctx: RouteContext) {
  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await ctx.params;
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      actions: { orderBy: { createdAt: 'asc' } },
      votes: { orderBy: { votedAt: 'asc' } },
      moderationDecision: true,
      feedbacks: { orderBy: { createdAt: 'desc' } },
      cancelledByStaffSession: { select: { id: true, pubkey: true, role: true } },
    },
  });
  if (!proposal) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return NextResponse.json({ proposal }, { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const tooBig = assertBodySizeWithin(req, 8_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.proposals.patch:${clientIp}`, 30, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const { id } = await ctx.params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true, status: true, pinned: true, title: true },
  });
  if (!proposal) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const changes: Record<string, unknown> = {};
  const dataUpdate: Record<string, unknown> = {};

  if (typeof body.pinned === 'boolean' && body.pinned !== proposal.pinned) {
    dataUpdate.pinned = body.pinned;
    changes.pinned = { from: proposal.pinned, to: body.pinned };
  }

  let cancelApplied = false;
  if (typeof body.cancelReason === 'string' && body.cancelReason.trim()) {
    if (['APPLIED'].includes(proposal.status)) {
      return NextResponse.json(
        { error: 'cannot force-cancel APPLIED proposal; use force-rollback first' },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      );
    }
    if (proposal.status !== 'CANCELLED') {
      const reason = body.cancelReason.trim().slice(0, 500);
      dataUpdate.status = 'CANCELLED';
      dataUpdate.cancelReason = reason;
      dataUpdate.cancelledByStaffSessionId = session.id;
      dataUpdate.decidedAt = new Date();
      changes.status = { from: proposal.status, to: 'CANCELLED' };
      changes.cancelReason = reason;
      cancelApplied = true;
    }
  }

  if (Object.keys(dataUpdate).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true }, { headers: { 'cache-control': 'no-store' } });
  }

  await prisma.proposal.update({ where: { id }, data: dataUpdate });

  if ('pinned' in dataUpdate) {
    await recordAuditEvent({
      session,
      action: dataUpdate.pinned ? AuditAction.ProposalPin : AuditAction.ProposalUnpin,
      targetType: 'Proposal',
      targetId: id,
      meta: { title: proposal.title ?? null },
    });
  }
  if (cancelApplied) {
    await recordAuditEvent({
      session,
      action: AuditAction.ProposalForceCancel,
      targetType: 'Proposal',
      targetId: id,
      meta: {
        title: proposal.title ?? null,
        fromStatus: proposal.status,
        reason: typeof dataUpdate.cancelReason === 'string' ? dataUpdate.cancelReason : null,
      },
    });
  }

  return NextResponse.json({ ok: true, changes }, { headers: { 'cache-control': 'no-store' } });
}

type DeleteBody = {
  /** Комментарий в AuditLog (опционально). */
  reason?: string;
};

/**
 * Жёсткое удаление предложения из БД (staff: ADMIN или MODERATOR).
 * Статус `APPLIED` запрещён: сначала полностью откатите эффекты через `POST .../force-rollback`,
 * пока статус не станет пригодным к удалению (обычно `ACCEPTED` без оставшейся истории).
 */
export async function DELETE(req: Request, ctx: RouteContext) {
  const tooBig = assertBodySizeWithin(req, 8_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.proposals.delete:${clientIp}`, 15, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const { id } = await ctx.params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid id' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  let reason: string | null = null;
  try {
    const body = (await req.json()) as DeleteBody | null;
    if (body && typeof body.reason === 'string') {
      reason = body.reason.trim().slice(0, 500) || null;
    }
  } catch {
    // тело не обязательно
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, authorPubkey: true },
  });
  if (!proposal) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (proposal.status === 'APPLIED') {
    return NextResponse.json(
      {
        error:
          'cannot delete APPLIED proposal: rollback network effects first via POST /api/admin/proposals/[id]/force-rollback until status is no longer APPLIED',
      },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await hardDeleteProposalInTransaction(tx, id);
    });

    await recordAuditEvent({
      session,
      action: AuditAction.ProposalAdminHardDelete,
      targetType: 'Proposal',
      targetId: id,
      meta: {
        reason,
        formerStatus: proposal.status,
        title: proposal.title ?? null,
        authorPubkey: proposal.authorPubkey,
      },
    });

    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[admin.proposals.delete] failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
