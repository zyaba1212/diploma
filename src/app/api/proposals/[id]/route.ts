import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: {
        actions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    return NextResponse.json(proposal, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('Failed to get proposal', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
