import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuditAction } from '@/lib/audit';

export function userBannedResponseOk(): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'banned' },
    { status: 403, headers: { 'cache-control': 'no-store' } },
  );
}

export function userBannedResponsePlain(): NextResponse {
  return NextResponse.json({ error: 'banned' }, { status: 403, headers: { 'cache-control': 'no-store' } });
}

export type UserBanDetails = {
  userPubkey: string;
  bannedAt: string;
  bannedReason: string | null;
  bannedByPubkey: string | null;
  bannedByUsername: string | null;
};

/** `true` if a `User` row exists and `bannedAt` is set. */
export async function isUserBanned(pubkey: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { pubkey },
    select: { bannedAt: true },
  });
  return u != null && u.bannedAt != null;
}

/** Полные детали бана для страницы блокировки; `null`, если пользователь не заблокирован. */
export async function getUserBanDetails(pubkey: string): Promise<UserBanDetails | null> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { id: true, pubkey: true, bannedAt: true, bannedReason: true },
  });
  if (!user?.bannedAt) return null;

  const lastBanAudit = await prisma.auditLog.findFirst({
    where: {
      action: AuditAction.UserBan,
      targetType: 'User',
      targetId: user.id,
    },
    orderBy: { at: 'desc' },
    select: { actorPubkey: true },
  });

  let bannedByUsername: string | null = null;
  const bannedByPubkey = lastBanAudit?.actorPubkey ?? null;
  if (bannedByPubkey) {
    const actor = await prisma.user.findUnique({
      where: { pubkey: bannedByPubkey },
      select: { username: true },
    });
    bannedByUsername = actor?.username ?? null;
  }

  return {
    userPubkey: user.pubkey,
    bannedAt: user.bannedAt.toISOString(),
    bannedReason: user.bannedReason ?? null,
    bannedByPubkey,
    bannedByUsername,
  };
}
