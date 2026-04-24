import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/rateLimit';
import { validateUsernameFormat } from '@/lib/username';
import { userBannedResponseOk } from '@/lib/user-ban';

type Body = {
  publicKey?: string;
  pubkey?: string;
  message?: string;
  signature?: string; // base58
};

export async function POST(req: Request) {
  const clientIp = getClientIp(req);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const publicKey = body.publicKey || body.pubkey;
  const message = body.message;
  const signature = body.signature;

  if (!publicKey || !message || !signature) {
    return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
  }

  try {
    const sigBytes = bs58.decode(signature);
    const pkBytes = bs58.decode(publicKey);
    const msgBytes = new TextEncoder().encode(message);

    const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
    if (!ok) return NextResponse.json({ ok: false, error: 'signature invalid' }, { status: 401 });

    async function generateRandomUsernameUnique(): Promise<string> {
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';

      // Try multiple candidates to avoid unique constraint collisions.
      for (let attempt = 0; attempt < 10; attempt++) {
        let s = '';
        const len = 12 + (attempt % 5); // 12..16
        for (let i = 0; i < len; i++) {
          const b = randomBytes(1)[0];
          s += alphabet[b % alphabet.length];
        }

        const fmt = validateUsernameFormat(s);
        if (!fmt.ok) continue;

        const existing = await prisma.user.findUnique({
          where: { username: s },
          select: { pubkey: true },
        });
        if (!existing) return s;
      }

      throw new Error('failed to generate unique username');
    }

    const existing = await prisma.user.findUnique({
      where: { pubkey: publicKey },
      select: { username: true, bannedAt: true },
    });

    if (existing?.bannedAt) {
      return userBannedResponseOk();
    }

    if (!existing) {
      const username = await generateRandomUsernameUnique();
      await prisma.user.create({
        data: { pubkey: publicKey, username, usernameSetAt: null },
      });
    } else if (!existing.username) {
      const username = await generateRandomUsernameUnique();
      await prisma.user.update({
        where: { pubkey: publicKey },
        data: { username, usernameSetAt: null },
      });
    }

    await prisma.userAuthSession.create({
      data: {
        pubkey: publicKey,
        ip: clientIp,
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'verify failed' }, { status: 400 });
  }
}

