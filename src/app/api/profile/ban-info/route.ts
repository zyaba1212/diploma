import { NextResponse } from 'next/server';
import { getUserBanDetails } from '@/lib/user-ban';

/**
 * GET /api/profile/ban-info?pubkey=<base58>
 * Возвращает детальную информацию о бане пользователя.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pubkey = searchParams.get('pubkey')?.trim() ?? '';
  if (!pubkey) {
    return NextResponse.json({ error: 'missing pubkey' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const ban = await getUserBanDetails(pubkey);
  if (!ban) {
    return NextResponse.json({ isBanned: false }, { headers: { 'cache-control': 'no-store' } });
  }

  return NextResponse.json(
    {
      isBanned: true,
      pubkey: ban.userPubkey,
      bannedAt: ban.bannedAt,
      bannedReason: ban.bannedReason,
      bannedByPubkey: ban.bannedByPubkey,
      bannedByUsername: ban.bannedByUsername,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
