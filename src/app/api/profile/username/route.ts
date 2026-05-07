import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { prisma } from '@/lib/prisma';
import { isUserBanned, userBannedResponseOk } from '@/lib/user-ban';
import {
  buildUsernameMessage,
  computeUsernameNextChangeAt,
  formatUsernameCooldownRemaining,
  normalizeUsername,
  validateUsernameFormat,
} from '@/lib/username';

type Body = {
  publicKey?: string;
  pubkey?: string;
  message?: string;
  signature?: string;
  username?: string;
};

/**
 * POST /api/profile/username
 * Обновление username с учётом подписи, уникальности и политики cooldown.
 * Никнейм можно менять, но не чаще одного раза в 30 дней.
 * Идемпотентный случай (тот же ник) разрешён всегда, без сброса таймера.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const publicKey = body.publicKey || body.pubkey;
  const message = body.message;
  const signature = body.signature;
  const usernameRaw = body.username;

  if (!publicKey || !message || !signature || typeof usernameRaw !== 'string') {
    return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
  }

  const username = normalizeUsername(usernameRaw);
  const fmt = validateUsernameFormat(username);
  if (!fmt.ok) {
    return NextResponse.json({ ok: false, error: fmt.error }, { status: 400 });
  }

  try {
    const sigBytes = bs58.decode(signature);
    const pkBytes = bs58.decode(publicKey);
    const msgBytes = new TextEncoder().encode(message);

    const sigOk = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
    if (!sigOk) {
      return NextResponse.json({ ok: false, error: 'signature invalid' }, { status: 401 });
    }

    const lines = message.split('\n');
    if (lines[0] !== 'diploma-z96a username') {
      return NextResponse.json({ ok: false, error: 'message format invalid' }, { status: 400 });
    }
    let msgPub: string | null = null;
    let msgUser: string | null = null;
    for (const line of lines.slice(1)) {
      if (line.startsWith('pubkey=')) msgPub = line.slice('pubkey='.length);
      if (line.startsWith('username=')) msgUser = normalizeUsername(line.slice('username='.length));
    }
    if (msgPub !== publicKey || msgUser !== username) {
      return NextResponse.json({ ok: false, error: 'message does not match payload' }, { status: 400 });
    }

    if (await isUserBanned(publicKey)) {
      return userBannedResponseOk();
    }

    const existing = await prisma.user.findUnique({
      where: { pubkey: publicKey },
      select: { username: true, usernameSetAt: true },
    });

    // Идемпотентный случай: ник тот же. Разрешаем всегда и не сдвигаем таймер.
    if (existing?.username === username && existing.usernameSetAt) {
      return NextResponse.json({
        ok: true,
        username,
        idempotent: true,
        usernameSetAt: existing.usernameSetAt.toISOString(),
        usernameNextChangeAt: computeUsernameNextChangeAt(existing.usernameSetAt)?.toISOString() ?? null,
      });
    }

    // Cooldown-проверка: если ник уже был зафиксирован и пытаемся сменить на другой до истечения периода.
    if (existing?.usernameSetAt) {
      const nextAt = computeUsernameNextChangeAt(existing.usernameSetAt);
      if (nextAt) {
        const msRemaining = nextAt.getTime() - Date.now();
        return NextResponse.json(
          {
            ok: false,
            error: `смена никнейма доступна через ${formatUsernameCooldownRemaining(msRemaining)}`,
            code: 'username_cooldown',
            msRemaining,
            nextChangeAt: nextAt.toISOString(),
            usernameSetAt: existing.usernameSetAt.toISOString(),
          },
          { status: 429 },
        );
      }
    }

    const taken = await prisma.user.findFirst({
      where: { username, NOT: { pubkey: publicKey } },
    });
    if (taken) {
      return NextResponse.json({ ok: false, error: 'username taken' }, { status: 409 });
    }

    const saved = await prisma.user.upsert({
      where: { pubkey: publicKey },
      create: {
        pubkey: publicKey,
        username,
        usernameSetAt: new Date(),
      },
      update: {
        username,
        usernameSetAt: new Date(),
      },
      select: { usernameSetAt: true },
    });

    return NextResponse.json({
      ok: true,
      username,
      usernameSetAt: saved.usernameSetAt?.toISOString() ?? null,
      usernameNextChangeAt: computeUsernameNextChangeAt(saved.usernameSetAt)?.toISOString() ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'request failed' }, { status: 400 });
  }
}
