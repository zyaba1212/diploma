import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ProposalStatus, Scope } from '@prisma/client';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

type CreateProposalBody = {
  scope?: Scope | string;
  title?: string;
  description?: string;
  authorPubkey?: string;
};

function parseScope(value: string | null): Scope | null {
  if (!value) return null;
  if (value === 'GLOBAL' || value === 'LOCAL') return value;
  return null;
}

function parseStatus(value: string | null): ProposalStatus | null {
  if (!value) return null;
  if (value === 'DRAFT' || value === 'SUBMITTED' || value === 'ACCEPTED' || value === 'REJECTED' || value === 'APPLIED') {
    return value;
  }
  return null;
}

function parseLimit(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 100);
}

function parseOffset(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function POST(req: Request) {
  const tooBig = assertBodySizeWithin(req, 200_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.create:${clientIp}`, 20, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: CreateProposalBody;
  try {
    body = (await req.json()) as CreateProposalBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const scope = typeof body.scope === 'string' ? parseScope(body.scope) : null;
  const authorPubkey = typeof body.authorPubkey === 'string' ? body.authorPubkey.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : undefined;
  const description = typeof body.description === 'string' ? body.description.trim() : undefined;

  if (!scope) {
    return NextResponse.json({ error: 'invalid scope' }, { status: 400 });
  }
  if (!authorPubkey) {
    return NextResponse.json({ error: 'authorPubkey is required' }, { status: 400 });
  }

  try {
    const proposal = await prisma.proposal.create({
      data: {
        scope,
        authorPubkey,
        status: 'DRAFT',
        title,
        description,
      },
    });

    return NextResponse.json(proposal, { status: 201 });
  } catch (err) {
    console.error('Failed to create proposal', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const scopeParam = url.searchParams.get('scope');
  const statusParam = url.searchParams.get('status');
  const authorPubkeyParam = url.searchParams.get('authorPubkey');
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');

  const scope = scopeParam ? parseScope(scopeParam) : null;
  if (scopeParam && !scope) {
    return NextResponse.json({ error: 'invalid scope' }, { status: 400 });
  }

  let statusFilter: string | string[] | null = null;
  if (statusParam) {
    if (statusParam.includes(',')) {
      const statuses = statusParam.split(',').map(s => s.trim()).filter(s => parseStatus(s) !== null);
      if (statuses.length === 0) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      statusFilter = statuses;
    } else {
      const status = parseStatus(statusParam);
      if (!status) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      statusFilter = status;
    }
  }

  const limit = parseLimit(limitParam) ?? 20;
  if (limitParam && parseLimit(limitParam) === null) {
    return NextResponse.json({ error: 'invalid limit' }, { status: 400 });
  }

  const offset = parseOffset(offsetParam) ?? 0;
  if (offsetParam && parseOffset(offsetParam) === null) {
    return NextResponse.json({ error: 'invalid offset' }, { status: 400 });
  }

  const where: Record<string, unknown> = {};
  if (scope) where.scope = scope;
  if (statusFilter) {
    where.status = Array.isArray(statusFilter) ? { in: statusFilter } : statusFilter;
  }
  if (authorPubkeyParam) where.authorPubkey = authorPubkeyParam;

  try {
    const proposals = await prisma.proposal.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        scope: true,
        authorPubkey: true,
        status: true,
        title: true,
        description: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
        submittedAt: true,
        decidedAt: true,
        votingEndsAt: true,
      },
    });

    return NextResponse.json(proposals, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('Failed to list proposals', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
