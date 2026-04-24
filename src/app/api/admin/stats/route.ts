import { NextResponse } from 'next/server';

import { requireStaff } from '@/lib/admin-guard';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const gate = await requireStaff(req);
  if (gate instanceof NextResponse) return gate;
  const session = gate;

  const [
    userCount,
    bannedCount,
    moderatorCount,
    activeSessionCount,
    proposalsByStatus,
    pinnedCount,
    newsCount,
    recentDecisions,
    recentAudit,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { bannedAt: { not: null } } }),
    prisma.moderatorGrant.count(),
    prisma.staffSession.count({ where: { expiresAt: { gt: new Date() } } }),
    prisma.proposal.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.proposal.count({ where: { pinned: true } }),
    prisma.newsCache.count(),
    prisma.moderationDecision.findMany({
      take: 5,
      orderBy: { decidedAt: 'desc' },
      include: { proposal: { select: { id: true, title: true } } },
    }),
    prisma.auditLog.findMany({ take: 5, orderBy: { at: 'desc' } }),
  ]);

  const proposalCounts: Record<string, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    ACCEPTED: 0,
    REJECTED: 0,
    APPLIED: 0,
    CANCELLED: 0,
  };
  for (const row of proposalsByStatus) {
    proposalCounts[row.status] = row._count._all;
  }

  return NextResponse.json(
    {
      role: session.role,
      users: { total: userCount, banned: bannedCount, moderators: moderatorCount },
      sessions: { active: activeSessionCount },
      proposals: { byStatus: proposalCounts, pinned: pinnedCount },
      news: { total: newsCount },
      recentDecisions: recentDecisions.map((d) => ({
        id: d.id,
        proposalId: d.proposalId,
        proposalTitle: d.proposal.title,
        moderatorPubkey: d.moderatorPubkey,
        toStatus: d.toStatus,
        decidedAt: d.decidedAt.toISOString(),
      })),
      recentAudit: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        at: a.at instanceof Date ? a.at.toISOString() : a.at,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
