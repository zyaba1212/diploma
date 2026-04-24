// HTTP API /api/proposals/[id]/vote — Next.js Route Handler.

import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';

type Params = { params: Promise<{ id: string }> };

async function tallyIfExpired(proposalId: string) {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { status: true, votingEndsAt: true },
  });
  if (!proposal || proposal.status !== 'SUBMITTED' || !proposal.votingEndsAt) return;
  if (proposal.votingEndsAt > new Date()) return;

  const votes = await prisma.vote.groupBy({
    by: ['voteType'],
    where: { proposalId },
    _count: true,
  });

  const forCount = votes.find(v => v.voteType === 'FOR')?._count ?? 0;
  const againstCount = votes.find(v => v.voteType === 'AGAINST')?._count ?? 0;
  const newStatus = forCount > againstCount ? 'ACCEPTED' : 'REJECTED';

  await prisma.$transaction([
    prisma.proposal.update({
      where: { id: proposalId },
      data: { status: newStatus, decidedAt: new Date() },
    }),
    prisma.moderationDecision.upsert({
      where: { proposalId },
      create: {
        proposalId,
        moderatorPubkey: 'system-vote-tally',
        fromStatus: 'SUBMITTED',
        toStatus: newStatus,
      },
      update: {
        moderatorPubkey: 'system-vote-tally',
        fromStatus: 'SUBMITTED',
        toStatus: newStatus,
        decidedAt: new Date(),
      },
    }),
  ]);
}

export async function POST(req: Request, { params }: Params) {
  const tooBig = assertBodySizeWithin(req, 10_000);
  if (tooBig) return tooBig;
  const { id } = await params;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.vote:${clientIp}`, 30, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: { voteType?: string; voterPubkey?: string; signature?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const voteType = body.voteType === 'FOR' || body.voteType === 'AGAINST' ? body.voteType : null;
  const voterPubkey = typeof body.voterPubkey === 'string' ? body.voterPubkey.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';

  if (!voteType) return NextResponse.json({ error: 'voteType must be FOR or AGAINST' }, { status: 400 });
  if (!voterPubkey || !signature) return NextResponse.json({ error: 'voterPubkey and signature required' }, { status: 400 });

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true, status: true, votingEndsAt: true, authorPubkey: true },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Auto-tally if voting period ended
  if (proposal.status === 'SUBMITTED' && proposal.votingEndsAt && proposal.votingEndsAt <= new Date()) {
    await tallyIfExpired(id);
    return NextResponse.json({ error: 'voting period ended' }, { status: 400 });
  }

  if (proposal.status !== 'SUBMITTED') return NextResponse.json({ error: 'proposal is not accepting votes' }, { status: 400 });

  // Verify signature
  const expectedMessage = `diploma-z96a vote:${id}:${voteType.toLowerCase()}`;
  try {
    const sigBytes = bs58.decode(signature);
    const pkBytes = bs58.decode(voterPubkey);
    const msgBytes = new TextEncoder().encode(expectedMessage);
    const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
    if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'invalid base58' }, { status: 400 });
  }

  if (await isUserBanned(voterPubkey)) {
    return userBannedResponsePlain();
  }

  // Send on-chain Memo tx (dev mode: mock)
  let txSignature: string | null = null;
  if (process.env.NODE_ENV !== 'production') {
    txSignature = `dev-vote-${id.slice(0, 8)}-${voterPubkey.slice(0, 8)}`;
  }

  try {
    const vote = await prisma.vote.create({
      data: { proposalId: id, voterPubkey, voteType, signature, txSignature },
    });
    return NextResponse.json({ id: vote.id, voteType: vote.voteType, txSignature }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'already voted on this proposal' }, { status: 409 });
    }
    console.error('Vote creation failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;

  const url = new URL(req.url);
  const voterPubkey = url.searchParams.get('voterPubkey');

  await tallyIfExpired(id);

  const votes = await prisma.vote.groupBy({
    by: ['voteType'],
    where: { proposalId: id },
    _count: true,
  });

  const forCount = votes.find(v => v.voteType === 'FOR')?._count ?? 0;
  const againstCount = votes.find(v => v.voteType === 'AGAINST')?._count ?? 0;

  let userVote: string | null = null;
  if (voterPubkey) {
    const existing = await prisma.vote.findUnique({
      where: { proposalId_voterPubkey: { proposalId: id, voterPubkey } },
      select: { voteType: true },
    });
    if (existing) userVote = existing.voteType;
  }

  return NextResponse.json({
    for: forCount,
    against: againstCount,
    total: forCount + againstCount,
    userVote,
  }, { headers: { 'cache-control': 'no-store' } });
}
