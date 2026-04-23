import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import type { StaffRole } from '@prisma/client';

import { verifyAdminLoginNonce } from '@/lib/admin-login-nonce';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { isModeratorPubkeyAllowed } from '@/lib/moderation/decideProposal';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { createStaffSessionInDb, staffSessionCookieHeader } from '@/lib/staff-session';
import { isUserBanned } from '@/lib/user-ban';

type Body = {
  publicKey?: string;
  pubkey?: string;
  message?: string;
  signature?: string;
  nonce?: string;
};

function buildExpectedAdminLoginMessage(nonce: string): string {
  return `diploma-z96a admin-login\nnonce=${nonce}`;
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(req: Request) {
  const tooBig = assertBodySizeWithin(req, 50_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.login.wallet:${clientIp}`, 10, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const adminPk = process.env.ADMIN_WALLET_PUBKEY?.trim() || null;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const publicKey = (body.publicKey || body.pubkey || '').trim();
  const message = body.message;
  const signature = body.signature;
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';

  if (!publicKey || !message || !signature || !nonce) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  if (await isUserBanned(publicKey)) {
    return NextResponse.json({ error: 'banned' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }

  // Stage 13: роль определяется источником авторизации.
  // 1. ADMIN_WALLET_PUBKEY → ADMIN.
  // 2. ModeratorGrant или MODERATOR_PUBKEYS → MODERATOR.
  // 3. иначе 401.
  let role: StaffRole;
  if (adminPk && publicKey === adminPk) {
    role = 'ADMIN';
  } else if (await isModeratorPubkeyAllowed(publicKey)) {
    role = 'MODERATOR';
  } else {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }

  if (!verifyAdminLoginNonce(nonce)) {
    return NextResponse.json({ error: 'nonce invalid or expired' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }

  const expected = buildExpectedAdminLoginMessage(nonce);
  if (!timingSafeEqualUtf8(message, expected)) {
    return NextResponse.json({ error: 'message mismatch' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }

  try {
    const sigBytes = bs58.decode(signature);
    const pkBytes = bs58.decode(publicKey);
    const msgBytes = new TextEncoder().encode(message);
    const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
    if (!ok) {
      return NextResponse.json({ error: 'signature invalid' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    }
  } catch {
    return NextResponse.json({ error: 'invalid base58' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const { rawToken } = await createStaffSessionInDb({ role, pubkey: publicKey });
  const res = NextResponse.json({ ok: true, role }, { headers: { 'cache-control': 'no-store' } });
  res.headers.append('Set-Cookie', staffSessionCookieHeader(rawToken));
  return res;
}
