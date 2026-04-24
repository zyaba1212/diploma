import { NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { requireStaff } from '@/lib/admin-guard';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

type UserListCursor = { tier: number; createdAt: string; id: string };

type RawUserRow = {
  id: string;
  pubkey: string;
  username: string | null;
  createdAt: Date;
  bannedAt: Date | null;
  bannedReason: string | null;
  tier: number;
  hasGrant: boolean;
};

function encodeUserListCursor(c: UserListCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeUserListCursor(s: string): UserListCursor | null {
  try {
    const buf = Buffer.from(s, 'base64url');
    const j = JSON.parse(buf.toString('utf8')) as unknown;
    if (!j || typeof j !== 'object') return null;
    const o = j as Record<string, unknown>;
    if (typeof o.tier !== 'number' || typeof o.createdAt !== 'string' || typeof o.id !== 'string') return null;
    if (![0, 1, 2].includes(o.tier)) return null;
    return { tier: o.tier, createdAt: o.createdAt, id: o.id };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.users.list:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const cursorParam = url.searchParams.get('cursor');
  const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw))) : DEFAULT_LIMIT;

  let cursorDecoded: UserListCursor | null = null;
  if (cursorParam) {
    cursorDecoded = decodeUserListCursor(cursorParam);
    if (!cursorDecoded) {
      return NextResponse.json({ error: 'invalid cursor' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
  }

  const adminPk = process.env.ADMIN_WALLET_PUBKEY?.trim() ?? '';

  const whereSearch =
    q.length > 0
      ? Prisma.sql`(u.pubkey ILIKE ${'%' + q + '%'} OR (u.username IS NOT NULL AND u.username ILIKE ${'%' + q + '%'}))`
      : Prisma.sql`TRUE`;

  const whereCursor =
    cursorDecoded === null
      ? Prisma.sql`TRUE`
      : Prisma.sql`(
          sub.tier > ${cursorDecoded.tier}
          OR (
            sub.tier = ${cursorDecoded.tier}
            AND (
              sub."createdAt" < ${new Date(cursorDecoded.createdAt)}
              OR (sub."createdAt" = ${new Date(cursorDecoded.createdAt)} AND sub.id < ${cursorDecoded.id})
            )
          )
        )`;

  const rows = await prisma.$queryRaw<RawUserRow[]>`
    SELECT sub.id, sub.pubkey, sub.username, sub."createdAt", sub."bannedAt", sub."bannedReason", sub.tier, sub."hasGrant"
    FROM (
      SELECT
        u.id,
        u.pubkey,
        u.username,
        u."createdAt",
        u."bannedAt",
        u."bannedReason",
        CASE
          WHEN ${adminPk} <> '' AND u.pubkey = ${adminPk} THEN 0
          WHEN mg."userId" IS NOT NULL THEN 1
          ELSE 2
        END AS tier,
        (mg."userId" IS NOT NULL) AS "hasGrant"
      FROM "User" u
      LEFT JOIN "ModeratorGrant" mg ON mg."userId" = u.id
      WHERE ${whereSearch}
    ) sub
    WHERE ${whereCursor}
    ORDER BY sub.tier ASC, sub."createdAt" DESC, sub.id DESC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);

  const items = pageRows.map((u) => ({
    id: u.id,
    pubkey: u.pubkey,
    username: u.username,
    createdAt: u.createdAt.toISOString(),
    isAdmin: adminPk !== '' ? u.pubkey === adminPk : false,
    isModerator: Boolean(u.hasGrant),
    bannedAt: u.bannedAt?.toISOString() ?? null,
    bannedReason: u.bannedReason,
  }));

  const last = pageRows.length > 0 ? pageRows[pageRows.length - 1]! : null;
  const nextCursor =
    hasMore && last !== null
      ? encodeUserListCursor({
          tier: Number(last.tier),
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        })
      : null;

  return NextResponse.json(
    { items, nextCursor },
    { headers: { 'cache-control': 'no-store' } },
  );
}
