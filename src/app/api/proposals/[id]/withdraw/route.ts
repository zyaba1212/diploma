// POST /api/proposals/[id]/withdraw — автор снимает предложение с голосования (SUBMITTED → WITHDRAWN).

import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';

type Params = { params: Promise<{ id: string }> };

type Body = {
  authorPubkey?: string;
  signature?: string;
};

function prismaWithdrawErrorResponse(err: unknown): NextResponse | null {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const lower = rawMsg.toLowerCase();
  if (
    lower.includes('invalid input value for enum') ||
    (lower.includes('enum') && lower.includes('proposal')) ||
    lower.includes('proposalstatus')
  ) {
    return NextResponse.json(
      {
        error:
          'База данных не обновлена: отсутствует статус WITHDRAWN. Выполните миграции (prisma migrate deploy).',
        code: 'SCHEMA_ENUM_MISSING',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as Record<string, unknown> | undefined;
    const msg = typeof meta?.message === 'string' ? meta.message : '';
    if (err.code === 'P2002') {
      return NextResponse.json(
        { error: 'конфликт записи модерации', code: 'MODERATION_CONFLICT' },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      );
    }
  }
  return null;
}

export async function POST(req: Request, { params }: Params) {
  const tooBig = assertBodySizeWithin(req, 10_000);
  if (tooBig) return tooBig;

  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.withdraw:${clientIp}`, 20, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const authorPubkey = typeof body.authorPubkey === 'string' ? body.authorPubkey.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!authorPubkey) return NextResponse.json({ error: 'authorPubkey required' }, { status: 400 });
  if (!signature) return NextResponse.json({ error: 'signature required' }, { status: 400 });

  const expectedMessage = `diploma-z96a propose:withdraw:${id}`;
  let sigBytes: Uint8Array;
  let pkBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
    pkBytes = bs58.decode(authorPubkey);
  } catch {
    return NextResponse.json({ error: 'invalid base58 signature or pubkey' }, { status: 400 });
  }
  const msgBytes = new TextEncoder().encode(expectedMessage);
  if (!nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes)) {
    return NextResponse.json({ error: 'signature invalid' }, { status: 401 });
  }

  if (await isUserBanned(authorPubkey)) {
    return userBannedResponsePlain();
  }

  try {
    const existing = await prisma.proposal.findUnique({
      where: { id },
      select: { id: true, authorPubkey: true, status: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    if (existing.authorPubkey !== authorPubkey) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    }

    // Идемпотентность: уже снято автором
    if (existing.status === 'WITHDRAWN') {
      const row = await prisma.proposal.findUnique({
        where: { id },
        select: { id: true, status: true, decidedAt: true },
      });
      return NextResponse.json(
        { ok: true, proposal: row, alreadyWithdrawn: true },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }

    if (existing.status !== 'SUBMITTED') {
      return NextResponse.json(
        { error: 'withdraw allowed only for SUBMITTED proposals', code: 'INVALID_STATUS' },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      );
    }

    const row = await prisma.$transaction(async tx => {
      await tx.vote.deleteMany({ where: { proposalId: id } });

      const updated = await tx.proposal.updateMany({
        where: { id, authorPubkey, status: 'SUBMITTED' },
        data: {
          status: 'WITHDRAWN',
          votingEndsAt: null,
          decidedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        const cur = await tx.proposal.findUnique({
          where: { id },
          select: { status: true },
        });
        if (cur?.status === 'WITHDRAWN') {
          return tx.proposal.findUnique({
            where: { id },
            select: { id: true, status: true, decidedAt: true },
          });
        }
        throw new Error('CONCURRENT_STATUS_CHANGE');
      }

      await tx.moderationDecision.upsert({
        where: { proposalId: id },
        create: {
          proposalId: id,
          moderatorPubkey: 'system-author-withdraw',
          fromStatus: 'SUBMITTED',
          toStatus: 'WITHDRAWN',
          comment: 'Withdrawn by author',
        },
        update: {
          moderatorPubkey: 'system-author-withdraw',
          fromStatus: 'SUBMITTED',
          toStatus: 'WITHDRAWN',
          decidedAt: new Date(),
          comment: 'Withdrawn by author',
        },
      });

      return tx.proposal.findUnique({
        where: { id },
        select: { id: true, status: true, decidedAt: true },
      });
    });

    return NextResponse.json({ ok: true, proposal: row }, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (err: unknown) {
    const mapped = prismaWithdrawErrorResponse(err);
    if (mapped) return mapped;

    if (err instanceof Error && err.message === 'CONCURRENT_STATUS_CHANGE') {
      return NextResponse.json(
        { error: 'статус предложения изменился, обновите страницу', code: 'CONFLICT' },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      );
    }

    console.error('withdraw failed', err);
    return NextResponse.json(
      { error: 'withdraw_failed', code: 'INTERNAL', detail: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
