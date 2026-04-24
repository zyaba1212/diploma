import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.sessions.revoke_all:${clientIp}`, 5, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const removed = await prisma.staffSession.deleteMany({
    where: { id: { not: session.id } },
  });

  await recordAuditEvent({
    session,
    action: AuditAction.StaffSessionRevokeAll,
    meta: { removed: removed.count },
  });

  return NextResponse.json({ ok: true, removed: removed.count }, { headers: { 'cache-control': 'no-store' } });
}
