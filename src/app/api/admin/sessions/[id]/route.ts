import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { invalidateStaffSession } from '@/lib/staff-session';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: RouteContext) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.sessions.del:${clientIp}`, 40, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const { id: rawId } = await ctx.params;
  const id = rawId?.trim();
  if (!id) {
    return NextResponse.json({ error: 'missing id' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const target = await prisma.staffSession.findUnique({
    where: { id },
    select: { id: true, role: true, pubkey: true },
  });
  if (!target) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  await invalidateStaffSession(target.id);

  await recordAuditEvent({
    session,
    action: AuditAction.StaffSessionRevoke,
    targetType: 'StaffSession',
    targetId: target.id,
    meta: { role: target.role, pubkey: target.pubkey },
  });

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
