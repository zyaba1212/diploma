import { createHash, randomBytes } from 'node:crypto';

import type { StaffRole, StaffSession } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { STAFF_SESSION_COOKIE } from '@/lib/staff-session-constants';

export { STAFF_SESSION_COOKIE };

const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export function hashStaffToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function newStaffRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createStaffSessionInDb(
  opts: { role?: StaffRole; pubkey?: string | null } = {},
): Promise<{ rawToken: string; session: StaffSession }> {
  const rawToken = newStaffRawToken();
  const tokenHash = hashStaffToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000);
  const session = await prisma.staffSession.create({
    data: {
      tokenHash,
      expiresAt,
      role: opts.role ?? 'ADMIN',
      pubkey: opts.pubkey ?? null,
    },
  });
  return { rawToken, session };
}

export function staffSessionCookieHeader(rawToken: string): string {
  const parts = [
    `${STAFF_SESSION_COOKIE}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function staffSessionClearCookieHeader(): string {
  const parts = [`${STAFF_SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function readStaffRawTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${STAFF_SESSION_COOKIE}=`)) continue;
    const v = trimmed.slice(STAFF_SESSION_COOKIE.length + 1);
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  return null;
}

export async function findValidStaffSessionByRawToken(rawToken: string | null): Promise<StaffSession | null> {
  if (!rawToken) return null;
  const tokenHash = hashStaffToken(rawToken);
  return prisma.staffSession.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
  });
}

export async function invalidateStaffSession(sessionId: string): Promise<void> {
  await prisma.staffSession.deleteMany({ where: { id: sessionId } });
}

export async function invalidateStaffSessionByRawToken(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashStaffToken(rawToken);
  await prisma.staffSession.deleteMany({ where: { tokenHash } });
}

export async function getStaffSessionFromRequest(req: Request) {
  const raw = readStaffRawTokenFromCookieHeader(req.headers.get('cookie'));
  return findValidStaffSessionByRawToken(raw);
}
