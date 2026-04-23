import { NextResponse } from 'next/server';

import type { Prisma } from '@prisma/client';

import { requireStaff } from '@/lib/admin-guard';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.audit.list:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor');
  const action = (url.searchParams.get('action') ?? '').trim();
  const actorPubkey = (url.searchParams.get('actorPubkey') ?? '').trim();
  const targetType = (url.searchParams.get('targetType') ?? '').trim();
  const targetId = (url.searchParams.get('targetId') ?? '').trim();
  const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw))) : DEFAULT_LIMIT;

  const where: Prisma.AuditLogWhereInput = {};
  if (action) where.action = action;
  if (actorPubkey) where.actorPubkey = actorPubkey;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      staffSession: { select: { id: true, role: true, pubkey: true } },
    },
  });

  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    actorType: r.actorType,
    actorPubkey: r.actorPubkey,
    staffSession: r.staffSession
      ? { id: r.staffSession.id, role: r.staffSession.role, pubkey: r.staffSession.pubkey }
      : null,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    meta: r.meta,
    at: r.at.toISOString(),
  }));
  const nextCursor = rows.length > limit ? rows[limit].id : null;

  return NextResponse.json({ items, nextCursor }, { headers: { 'cache-control': 'no-store' } });
}
