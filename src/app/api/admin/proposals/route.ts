import { NextResponse } from 'next/server';

import type { Prisma, ProposalStatus, Scope } from '@prisma/client';

import { requireStaff } from '@/lib/admin-guard';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

const ALL_STATUSES: ProposalStatus[] = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'APPLIED', 'CANCELLED'];
const ALL_SCOPES: Scope[] = ['GLOBAL', 'LOCAL'];

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`admin.proposals.list:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429, headers: { 'cache-control': 'no-store' } });
  }

  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const cursor = url.searchParams.get('cursor');
  const statusParam = url.searchParams.get('status');
  const scopeParam = url.searchParams.get('scope');
  const author = (url.searchParams.get('author') ?? '').trim();
  const pinnedParam = url.searchParams.get('pinned');
  const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw))) : DEFAULT_LIMIT;

  const where: Prisma.ProposalWhereInput = {};
  if (statusParam && ALL_STATUSES.includes(statusParam as ProposalStatus)) {
    where.status = statusParam as ProposalStatus;
  }
  if (scopeParam && ALL_SCOPES.includes(scopeParam as Scope)) {
    where.scope = scopeParam as Scope;
  }
  if (author) {
    where.authorPubkey = author;
  }
  if (pinnedParam === 'true') where.pinned = true;
  else if (pinnedParam === 'false') where.pinned = false;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { id: { equals: q } },
    ];
  }

  const rows = await prisma.proposal.findMany({
    where,
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      scope: true,
      status: true,
      title: true,
      description: true,
      authorPubkey: true,
      pinned: true,
      createdAt: true,
      submittedAt: true,
      decidedAt: true,
      cancelReason: true,
      rejectionReason: true,
      _count: { select: { actions: true, votes: true, feedbacks: true } },
    },
  });

  const items = rows.slice(0, limit).map((p) => ({
    id: p.id,
    scope: p.scope,
    status: p.status,
    title: p.title,
    description: p.description,
    authorPubkey: p.authorPubkey,
    pinned: p.pinned,
    createdAt: p.createdAt.toISOString(),
    submittedAt: p.submittedAt?.toISOString() ?? null,
    decidedAt: p.decidedAt?.toISOString() ?? null,
    cancelReason: p.cancelReason,
    rejectionReason: p.rejectionReason,
    counts: p._count,
  }));

  const nextCursor = rows.length > limit ? rows[limit].id : null;

  return NextResponse.json({ items, nextCursor }, { headers: { 'cache-control': 'no-store' } });
}
