import { NextResponse } from 'next/server';

import type { StaffRole, StaffSession } from '@prisma/client';

import { isStaffPortalRole } from '@/lib/staff-portal-access';
import { getStaffSessionFromRequest } from '@/lib/staff-session';
import { isUserBanned } from '@/lib/user-ban';

/**
 * Stage 13 — единая проверка staff-сессии в роутах `/api/admin/*`.
 *
 * Возвращает `StaffSession` при успехе, либо `NextResponse` 401/403 для немедленного `return`.
 *
 * Пример использования:
 * ```ts
 * const gate = await requireAdmin(req);
 * if (gate instanceof NextResponse) return gate;
 * const session = gate;
 * ```
 */

const JSON_HEADERS = { 'cache-control': 'no-store' } as const;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: JSON_HEADERS });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: JSON_HEADERS });
}

function banned(): NextResponse {
  return NextResponse.json({ error: 'banned' }, { status: 403, headers: JSON_HEADERS });
}

/** Любая валидная staff-сессия (ADMIN или MODERATOR). */
export async function requireStaff(req: Request): Promise<StaffSession | NextResponse> {
  const session = await getStaffSessionFromRequest(req);
  if (!session) return unauthorized();
  if (!isStaffPortalRole(session.role)) return forbidden();
  if (session.pubkey && (await isUserBanned(session.pubkey))) return banned();
  return session;
}

/** Только ADMIN (назначение модераторов и `/api/admin/moderators*`). */
export async function requireAdmin(req: Request): Promise<StaffSession | NextResponse> {
  const session = await getStaffSessionFromRequest(req);
  if (!session) return unauthorized();
  if (session.role !== 'ADMIN') return forbidden();
  if (session.pubkey && (await isUserBanned(session.pubkey))) return banned();
  return session;
}

/** ADMIN или MODERATOR. */
export async function requireModerator(req: Request): Promise<StaffSession | NextResponse> {
  const session = await getStaffSessionFromRequest(req);
  if (!session) return unauthorized();
  if (!isStaffPortalRole(session.role)) return forbidden();
  if (session.pubkey && (await isUserBanned(session.pubkey))) return banned();
  return session;
}

/** Явная проверка «есть ли нужная роль у сессии». */
export function hasRole(session: StaffSession, ...roles: StaffRole[]): boolean {
  return roles.includes(session.role);
}
