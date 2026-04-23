import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

type RouteContext = { params: Promise<{ pubkey: string }> };
type Body = { reason?: string };

async function resolvePubkey(ctx: RouteContext): Promise<string | null> {
  const { pubkey: raw } = await ctx.params;
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  const tooBig = assertBodySizeWithin(req, 8_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.users.ban:${clientIp}`, 30, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const pubkey = await resolvePubkey(ctx);
  if (!pubkey) {
    return NextResponse.json({ error: 'invalid pubkey' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const adminPk = process.env.ADMIN_WALLET_PUBKEY?.trim() || null;
  if (adminPk && pubkey === adminPk) {
    return NextResponse.json({ error: 'cannot ban admin wallet' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  if (session.pubkey && session.pubkey === pubkey) {
    return NextResponse.json({ error: 'cannot ban self' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty/invalid body → reason stays empty
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

  const user = await prisma.user.findUnique({ where: { pubkey }, select: { id: true, username: true } });
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { bannedAt: new Date(), bannedReason: reason || null },
  });

  await recordAuditEvent({
    session,
    action: AuditAction.UserBan,
    targetType: 'User',
    targetId: user.id,
    meta: { pubkey, username: user.username, reason: reason || null },
  });

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.users.unban:${clientIp}`, 30, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const pubkey = await resolvePubkey(ctx);
  if (!pubkey) {
    return NextResponse.json({ error: 'invalid pubkey' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const user = await prisma.user.findUnique({ where: { pubkey }, select: { id: true, username: true, bannedAt: true } });
  if (!user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  if (!user.bannedAt) {
    return NextResponse.json({ ok: true, note: 'not banned' }, { headers: { 'cache-control': 'no-store' } });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { bannedAt: null, bannedReason: null },
  });

  await recordAuditEvent({
    session,
    action: AuditAction.UserUnban,
    targetType: 'User',
    targetId: user.id,
    meta: { pubkey, username: user.username },
  });

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
