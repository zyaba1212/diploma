import { NextResponse } from 'next/server';

import { createAdminLoginNonce } from '@/lib/admin-login-nonce';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.login.nonce:${clientIp}`, 30, 60_000))) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      { status: 429, headers: { 'cache-control': 'no-store' } },
    );
  }

  const n = createAdminLoginNonce();
  if (!n.ok) {
    return NextResponse.json({ error: n.error }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return NextResponse.json({ nonce: n.nonce }, { headers: { 'cache-control': 'no-store' } });
}
