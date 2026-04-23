import { NextResponse } from 'next/server';

import { isStaffPortalRole } from '@/lib/staff-portal-access';
import { findValidStaffSessionByRawToken, readStaffRawTokenFromCookieHeader } from '@/lib/staff-session';
import { isUserBanned } from '@/lib/user-ban';

export async function GET(req: Request) {
  const raw = readStaffRawTokenFromCookieHeader(req.headers.get('cookie'));
  const session = await findValidStaffSessionByRawToken(raw);
  if (!session || !isStaffPortalRole(session.role)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  if (session.pubkey && (await isUserBanned(session.pubkey))) {
    return NextResponse.json({ ok: false, error: 'banned' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  return NextResponse.json(
    { ok: true, role: session.role, pubkey: session.pubkey ?? null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
