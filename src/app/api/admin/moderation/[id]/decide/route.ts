import { NextResponse } from 'next/server';

import { requireModerator } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { handleModerationDecision, parseToStatus } from '@/lib/moderation/decideProposal';

type RouteContext = { params: Promise<{ id: string }> };
type Body = {
  toStatus?: string;
  decision?: string;
  comment?: string | null;
  rejectionReason?: string | null;
};

/**
 * Stage 13 — staff-based модерация: авторизация через staff-cookie,
 * без Phantom-подписи. Авторизованная роль: ADMIN или MODERATOR.
 * Переиспользует ядро `handleModerationDecision`.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const tooBig = assertBodySizeWithin(req, 20_000);
  if (tooBig) return tooBig;

  const gate = await requireModerator(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  if (!session.pubkey) {
    return NextResponse.json(
      { error: 'staff session has no associated pubkey; re-login via wallet' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  const { id: proposalId } = await ctx.params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const decisionRaw = typeof body.toStatus === 'string' ? body.toStatus : body.decision;
  const toStatus = decisionRaw ? parseToStatus(decisionRaw) : null;
  if (!toStatus || (toStatus !== 'ACCEPTED' && toStatus !== 'REJECTED')) {
    return NextResponse.json(
      { error: "toStatus must be 'ACCEPTED' or 'REJECTED'" },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null;
  const rejectionReason =
    toStatus === 'REJECTED' && typeof body.rejectionReason === 'string' && body.rejectionReason.trim()
      ? body.rejectionReason.trim()
      : null;

  const resp = await handleModerationDecision(req, {
    proposalId,
    moderatorPubkey: session.pubkey,
    toStatus,
    comment,
    rejectionReason,
    trustedFromStaff: true,
    skipModeratorAllowlistCheck: true,
  });

  if (resp.status >= 200 && resp.status < 300) {
    await recordAuditEvent({
      session,
      action: AuditAction.ProposalModerationDecision,
      targetType: 'Proposal',
      targetId: proposalId,
      meta: { toStatus, comment, rejectionReason },
    });
  }

  return resp;
}
