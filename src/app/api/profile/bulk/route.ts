import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { internalApiError } from '@/lib/apiError';

type Body = {
  pubkeys?: string[];
};

export async function POST(req: Request) {
  const tooBig = assertBodySizeWithin(req, 200_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`profile.bulk:${clientIp}`, 30, 60_000))) {
    return NextResponse.json({ ok: false, error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const pubkeys = Array.isArray(body.pubkeys) ? body.pubkeys : [];
  if (pubkeys.length === 0) {
    return NextResponse.json({ ok: false, error: 'pubkeys required' }, { status: 400 });
  }

  const normalized = pubkeys
    .filter((p) => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return NextResponse.json({ ok: false, error: 'pubkeys required' }, { status: 400 });
  }

  try {
    const unique = Array.from(new Set(normalized));

    const users = await prisma.user.findMany({
      where: { pubkey: { in: unique } },
      select: { pubkey: true, username: true },
    });

    const byPubkey: Record<string, string | null> = {};
    for (const pk of unique) byPubkey[pk] = null;
    for (const u of users) {
      byPubkey[u.pubkey] = u.username ?? null;
    }

    return NextResponse.json({ ok: true, usernamesByPubkey: byPubkey }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return internalApiError('internal error', 500);
  }
}

