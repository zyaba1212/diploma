import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/admin-guard';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

type SessionsScope = 'all' | 'site' | 'staff';

function parseScope(raw: string | null): SessionsScope {
  if (raw === 'site' || raw === 'staff') return raw;
  return 'all';
}

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.sessions.list:${clientIp}`, 30, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const pubkeysRaw = url.searchParams.get('pubkeys');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const scope = parseScope(url.searchParams.get('scope'));

  const now = new Date();
  const pubkeys = (pubkeysRaw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const hasAnyFilter = pubkeys.length > 0 || Boolean(from) || Boolean(to);

  // Без фильтров показываем только активные staff-сессии; при фильтре по адресу/датам — все подходящие записи.
  const staffWhere: Record<string, unknown> = hasAnyFilter ? {} : { expiresAt: { gt: now } };
  const userWhere: Record<string, unknown> = {};

  if (pubkeys.length) {
    staffWhere.pubkey = { in: pubkeys };
    userWhere.pubkey = { in: pubkeys };
  }

  if (from || to) {
    const createdAtFilter: Record<string, Date> = {};
    if (from) {
      const parsedFrom = new Date(from);
      if (Number.isNaN(parsedFrom.getTime())) {
        return NextResponse.json({ error: 'invalid from date' }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
      createdAtFilter.gte = parsedFrom;
    }
    if (to) {
      const end = new Date(to);
      if (Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: 'invalid to date' }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
      end.setDate(end.getDate() + 1);
      createdAtFilter.lte = end;
    }
    staffWhere.createdAt = createdAtFilter;
    userWhere.createdAt = createdAtFilter;
  }

  const includeStaff = scope !== 'site';
  const includeUser = scope !== 'staff';

  let staffRows: Array<{
    id: string;
    role: string;
    pubkey: string | null;
    createdAt: Date;
    expiresAt: Date;
  }> = [];

  if (includeStaff) {
    staffRows = await prisma.staffSession.findMany({
      where: staffWhere,
      orderBy: { createdAt: 'desc' },
      select: { id: true, role: true, pubkey: true, createdAt: true, expiresAt: true },
    });
  }

  let userRows: Array<{ id: string; pubkey: string; createdAt: Date }> = [];
  let userSessionsOk = true;

  if (includeUser) {
    try {
      userRows = await prisma.userAuthSession.findMany({
        where: userWhere,
        orderBy: { createdAt: 'desc' },
        select: { id: true, pubkey: true, createdAt: true },
      });
    } catch (error) {
      console.error('admin.sessions.userAuthSession_failed', error);
      userSessionsOk = false;
    }
  }

  const items = [
    ...staffRows.map((s) => ({
      id: s.id,
      type: 'STAFF' as const,
      role: s.role,
      pubkey: s.pubkey,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
    ...userRows.map((s) => ({
      id: s.id,
      type: 'USER' as const,
      role: 'USER' as const,
      pubkey: s.pubkey,
      createdAt: s.createdAt.toISOString(),
      expiresAt: null,
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const pubkeySet = new Set<string>();
  for (const row of items) {
    if (row.pubkey) pubkeySet.add(row.pubkey);
  }
  const usernameByPubkey = new Map<string, string | null>();
  if (pubkeySet.size > 0) {
    const users = await prisma.user.findMany({
      where: { pubkey: { in: [...pubkeySet] } },
      select: { pubkey: true, username: true },
    });
    for (const u of users) {
      usernameByPubkey.set(u.pubkey, u.username);
    }
  }

  const itemsWithUser = items.map((row) => ({
    ...row,
    username: row.pubkey ? (usernameByPubkey.get(row.pubkey) ?? null) : null,
  }));

  return NextResponse.json(
    {
      items: itemsWithUser,
      userSessionsOk,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
