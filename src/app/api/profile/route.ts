import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/profile?pubkey=<base58>
 * Публичные данные профиля по pubkey (без секретов).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pubkey = searchParams.get('pubkey');
  if (!pubkey) {
    return NextResponse.json({ error: 'missing pubkey' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { pubkey: true, username: true, usernameSetAt: true, createdAt: true },
  });

  if (!user) {
    return NextResponse.json({
      pubkey,
      username: null,
      usernameSetAt: null,
      createdAt: null,
      inDatabase: false,
    });
  }

  return NextResponse.json({
    pubkey: user.pubkey,
    username: user.username,
    usernameSetAt: user.usernameSetAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    inDatabase: true,
  });
}
