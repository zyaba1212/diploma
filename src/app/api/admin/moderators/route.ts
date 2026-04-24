import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin-guard';
import { AuditAction, recordAuditEvent } from '@/lib/audit';
import { parseModeratorsEnv } from '@/lib/moderation/decideProposal';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

type Body = { pubkey?: string };

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await prisma.moderatorGrant.findMany({
    orderBy: { grantedAt: 'desc' },
    include: {
      user: { select: { pubkey: true, username: true } },
      grantedByStaffSession: { select: { id: true, pubkey: true, role: true } },
    },
  });

  const envAllowlist = Array.from(parseModeratorsEnv());

  return NextResponse.json(
    {
      moderators: rows.map((r) => ({
        userId: r.userId,
        pubkey: r.user.pubkey,
        username: r.user.username,
        grantedAt: r.grantedAt.toISOString(),
        grantedBy: r.grantedByStaffSession
          ? { pubkey: r.grantedByStaffSession.pubkey, role: r.grantedByStaffSession.role }
          : null,
      })),
      /** @deprecated — см. `docs/stage13-admin-panel.md`; для обратной совместимости Phantom-модерации. */
      envModeratorPubkeysDeprecated: envAllowlist,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  const tooBig = assertBodySizeWithin(req, 8_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.moderators.post:${clientIp}`, 30, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const pubkey = typeof body.pubkey === 'string' ? body.pubkey.trim() : '';
  if (!pubkey) {
    return NextResponse.json({ error: 'missing pubkey' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const user = await prisma.user.findUnique({ where: { pubkey }, select: { id: true, pubkey: true, username: true } });
  if (!user) {
    return NextResponse.json(
      { error: 'user not found — this wallet has not connected to the project yet' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  await prisma.moderatorGrant.upsert({
    where: { userId: user.id },
    create: { userId: user.id, grantedByStaffSessionId: session.id },
    update: { grantedByStaffSessionId: session.id, grantedAt: new Date() },
  });

  await recordAuditEvent({
    session,
    action: AuditAction.ModeratorAssign,
    targetType: 'User',
    targetId: user.id,
    meta: { pubkey: user.pubkey, username: user.username },
  });

  return NextResponse.json(
    { ok: true, moderator: { userId: user.id, pubkey: user.pubkey, username: user.username } },
    { headers: { 'cache-control': 'no-store' } },
  );
}
