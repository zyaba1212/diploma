import type { Prisma, StaffSession } from '@prisma/client';

import { prisma } from '@/lib/prisma';

/**
 * Stage 13 — единый журнал действий staff.
 *
 * Используется в роутах `/api/admin/*` для записи mutating-операций
 * (назначение модераторов, бан, принудительная отмена предложений и т.д.).
 *
 * Запись в журнал никогда не должна ломать бизнес-операцию: любые ошибки
 * логируются через `console.error`, а вызывающий код продолжает работу.
 */
export interface RecordAuditEventParams {
  session: StaffSession | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Prisma.InputJsonValue | null;
}

export async function recordAuditEvent(params: RecordAuditEventParams): Promise<void> {
  const { session, action, targetType, targetId, meta } = params;
  try {
    await prisma.auditLog.create({
      data: {
        actorType: session ? 'STAFF' : 'SYSTEM',
        staffSessionId: session?.id ?? null,
        actorPubkey: session?.pubkey ?? null,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        meta: meta ?? undefined,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record event', { action, targetType, targetId, err });
  }
}

/** Константы для `action` — чтобы не плодить строковые литералы по кодовой базе. */
export const AuditAction = {
  ModeratorAssign: 'moderator.assign',
  ModeratorRevoke: 'moderator.revoke',
  UserBan: 'user.ban',
  UserUnban: 'user.unban',
  ProposalPin: 'proposal.pin',
  ProposalUnpin: 'proposal.unpin',
  ProposalForceCancel: 'proposal.force_cancel',
  ProposalForceRollback: 'proposal.force_rollback',
  /** Жёсткое удаление строки предложения из БД (только staff / см. админ-API). */
  ProposalAdminHardDelete: 'proposal.admin_hard_delete',
  ProposalModerationDecision: 'proposal.moderation_decision',
  StaffSessionRevoke: 'staff_session.revoke',
  StaffSessionRevokeAll: 'staff_session.revoke_all',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];
