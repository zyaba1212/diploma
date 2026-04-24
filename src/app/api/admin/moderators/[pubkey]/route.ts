import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

type RouteContext = { params: Promise<{ pubkey: string }> };

export async function DELETE(req: Request, ctx: RouteContext) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.moderators.del:${clientIp}`, 40, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const { pubkey: raw } = await ctx.params;
  let pubkey: string;
  try {
    pubkey = decodeURIComponent(raw).trim();
  } catch {
    return NextResponse.json({ error: 'invalid pubkey' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  if (!pubkey) {
    return NextResponse.json({ error: 'missing pubkey' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const user = await prisma.user.findUnique({ where: { pubkey }, select: { id: true, username: true } });
  if (!user) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const removed = await prisma.moderatorGrant.deleteMany({ where: { userId: user.id } });

  if (removed.count > 0) {
    await recordAuditEvent({
      session,
      action: AuditAction.ModeratorRevoke,
      targetType: 'User',
      targetId: user.id,
      meta: { pubkey, username: user.username },
    });
  }

  return NextResponse.json({ ok: true, removed: removed.count }, { headers: { 'cache-control': 'no-store' } });
}
