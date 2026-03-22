import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listHistoryEntries } from '@/lib/stage7/historyStore';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id: proposalId } = await params;
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.history:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const history = await listHistoryEntries(prisma, proposalId, 50);
  // UI (and Stage 8 pre-check invariant) expects JSON array directly.
  return NextResponse.json(history, { headers: { 'cache-control': 'no-store' } });
}

