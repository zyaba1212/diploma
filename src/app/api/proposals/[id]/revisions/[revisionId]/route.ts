import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id, revisionId } = await params;
  if (!id || !revisionId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.revisions.get:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const row = await prisma.proposalRevision.findFirst({
    where: { id: revisionId, proposalId: id },
    select: {
      id: true,
      proposalId: true,
      parentRevisionId: true,
      authorPubkey: true,
      message: true,
      snapshot: true,
      diffSummary: true,
      isBaseline: true,
      createdAt: true,
    },
  });

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json(row, { status: 200, headers: { 'cache-control': 'no-store' } });
}
