import { NextResponse } from 'next/server';

import { invalidateStaffSessionByRawToken, readStaffRawTokenFromCookieHeader, staffSessionClearCookieHeader } from '@/lib/staff-session';

export async function POST(req: Request) {
  const raw = readStaffRawTokenFromCookieHeader(req.headers.get('cookie'));
  await invalidateStaffSessionByRawToken(raw);
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  res.headers.append('Set-Cookie', staffSessionClearCookieHeader());
  return res;
}
