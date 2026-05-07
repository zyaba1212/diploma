import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeUsernameNextChangeAt } from '@/lib/username';

/**
 * GET /api/profile?pubkey=<base58>
 * Публичные данные профиля по pubkey (без секретов).
 * Поле `usernameNextChangeAt` — момент, после которого пользователю будет
 * разрешена очередная смена никнейма (или `null`, если смена доступна сейчас).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pubkey = searchParams.get('pubkey');
  if (!pubkey) {
    return NextResponse.json({ error: 'missing pubkey' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { pubkey: true, username: true, usernameSetAt: true, createdAt: true, bannedAt: true },
  });

  if (!user) {
    return NextResponse.json(
      {
        pubkey,
        username: null,
        usernameSetAt: null,
        usernameNextChangeAt: null,
        createdAt: null,
        inDatabase: false,
        isBanned: false,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const isBanned = user.bannedAt != null;
  const nextChangeAt = computeUsernameNextChangeAt(user.usernameSetAt);

  return NextResponse.json(
    {
      pubkey: user.pubkey,
      username: user.username,
      usernameSetAt: user.usernameSetAt?.toISOString() ?? null,
      usernameNextChangeAt: nextChangeAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      inDatabase: true,
      isBanned,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
