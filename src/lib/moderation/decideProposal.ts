import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { ProposalStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { internalApiError } from '@/lib/apiError';
import { logApiMetric } from '@/lib/apiOps';

export function parseModeratorsEnv(): Set<string> {
  const raw = process.env.MODERATOR_PUBKEYS || '';
  // Allowlist is a base58 pubkey list.
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function isModeratorPubkeyAllowed(pubkey: string): Promise<boolean> {
  if (parseModeratorsEnv().has(pubkey)) return true;
  const grant = await prisma.moderatorGrant.findFirst({
    where: { user: { pubkey } },
    select: { userId: true },
  });
  return Boolean(grant);
}

function normalizeToStatus(value: string): ProposalStatus | null {
  const d = value.trim().toUpperCase();
  if (d === 'ACCEPT' || d === 'ACCEPTED') return 'ACCEPTED';
  if (d === 'REJECT' || d === 'REJECTED') return 'REJECTED';
  return null;
}

function verifyModeratorSignature(opts: {
  proposalId: string;
  toStatus: ProposalStatus;
  moderatorPubkey: string;
  signature: string;
}) {
  const { proposalId, toStatus, moderatorPubkey, signature } = opts;

  // Canonical message format documented in `docs/stage12-governance-moderation-architecture.md`.
  const message = `diploma-z96a moderate:${proposalId}:${toStatus}`;

  let sigBytes: Uint8Array;
  let pkBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
    pkBytes = bs58.decode(moderatorPubkey);
  } catch {
    return { ok: false as const, error: 'invalid base58 signature/pubkey' };
  }

  const msgBytes = new TextEncoder().encode(message);
  const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
  if (!ok) return { ok: false as const, error: 'signature invalid' };
  return { ok: true as const };
}

export async function handleModerationDecision(
  req: Request,
  args: {
    proposalId: string;
    moderatorPubkey: string;
    toStatus: ProposalStatus;
    signature?: string;
    /** Stage 13 — произвольный комментарий модератора, сохраняется в `ModerationDecision.comment`. */
    comment?: string | null;
    /** Stage 13 — причина отказа, сохраняется в `Proposal.rejectionReason` при REJECTED. */
    rejectionReason?: string | null;
    /** Stage 13 — если true, пропускаем проверку ed25519-подписи (источник — staff-сессия). */
    trustedFromStaff?: boolean;
    /** Stage 13 — если true, пропускаем проверку env/ModeratorGrant (проверено guard-ом). */
    skipModeratorAllowlistCheck?: boolean;
  },
) {
  const started = Date.now();

  const tooBig = assertBodySizeWithin(req, 50_000);
  if (tooBig) return tooBig;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`moderation.decide:${clientIp}`, 10, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  if (!args.skipModeratorAllowlistCheck && !(await isModeratorPubkeyAllowed(args.moderatorPubkey))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (args.signature && !args.trustedFromStaff) {
    const v = verifyModeratorSignature({
      proposalId: args.proposalId,
      toStatus: args.toStatus,
      moderatorPubkey: args.moderatorPubkey,
      signature: args.signature,
    });
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
  }

  const commentTrimmed = typeof args.comment === 'string' && args.comment.trim() ? args.comment.trim().slice(0, 1000) : null;

  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: args.proposalId },
      select: { id: true, status: true },
    });

    if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Idempotency: if already in target status — return the existing audit record id.
    if (proposal.status === args.toStatus) {
      const existing = await prisma.moderationDecision.findUnique({
        where: { proposalId: proposal.id },
        select: { id: true },
      });

      if (existing) {
        logApiMetric({
          route: '/api/moderation/proposals/:id/decide',
          method: 'POST',
          status: 200,
          durationMs: Date.now() - started,
          ok: true,
          note: 'already_decided',
        });
        return NextResponse.json({ ok: true, status: args.toStatus, moderationDecisionId: existing.id }, { headers: { 'cache-control': 'no-store' } });
      }

      // Extremely defensive fallback: if Proposal already updated but audit row missing.
      const created = await prisma.moderationDecision.create({
        data: {
          proposalId: proposal.id,
          moderatorPubkey: args.moderatorPubkey,
          fromStatus: proposal.status,
          toStatus: args.toStatus,
          decisionSignature: args.signature ?? null,
          comment: commentTrimmed,
        },
      });

      logApiMetric({
        route: '/api/moderation/proposals/:id/decide',
        method: 'POST',
        status: 200,
        durationMs: Date.now() - started,
        ok: true,
        note: 'already_decided',
      });
      return NextResponse.json({ ok: true, status: args.toStatus, moderationDecisionId: created.id }, { headers: { 'cache-control': 'no-store' } });
    }

    // First decision must come from SUBMITTED.
    if (proposal.status !== 'SUBMITTED') {
      return NextResponse.json({ error: 'proposal is not SUBMITTED' }, { status: 409 });
    }

    // Update proposal status in a single statement to reduce race windows.
    const now = new Date();
    const updatedCount = await prisma.proposal.updateMany({
      where: { id: proposal.id, status: 'SUBMITTED' },
      data: {
        status: args.toStatus,
        decidedAt: now,
        ...(args.toStatus === 'REJECTED' && args.rejectionReason
          ? { rejectionReason: args.rejectionReason.slice(0, 500) }
          : {}),
      },
    });

    if (updatedCount.count !== 1) {
      const current = await prisma.proposal.findUnique({ where: { id: proposal.id }, select: { status: true } });
      if (current?.status === args.toStatus) {
        const existing = await prisma.moderationDecision.findUnique({ where: { proposalId: proposal.id }, select: { id: true } });
        if (existing) {
          return NextResponse.json({ ok: true, status: args.toStatus, moderationDecisionId: existing.id }, { headers: { 'cache-control': 'no-store' } });
        }
        // Audit row missing due to a race; treat as conflict to avoid corrupting audit trail.
      }
      return NextResponse.json({ error: 'proposal already decided' }, { status: 409 });
    }

    const decisionRecord = await prisma.moderationDecision.upsert({
      where: { proposalId: proposal.id },
      update: {
        moderatorPubkey: args.moderatorPubkey,
        toStatus: args.toStatus,
        decisionSignature: args.signature ?? null,
        comment: commentTrimmed,
      },
      create: {
        proposalId: proposal.id,
        moderatorPubkey: args.moderatorPubkey,
        fromStatus: 'SUBMITTED',
        toStatus: args.toStatus,
        decisionSignature: args.signature ?? null,
        comment: commentTrimmed,
      },
    });

    logApiMetric({
      route: '/api/moderation/proposals/:id/decide',
      method: 'POST',
      status: 200,
      durationMs: Date.now() - started,
      ok: true,
      note: 'decided',
    });

    return NextResponse.json(
      { ok: true, status: args.toStatus, moderationDecisionId: decisionRecord.id },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return internalApiError('internal error', 500);
  }
}

// Exported helper for route handlers.
export function parseToStatus(decisionOrStatus: string): ProposalStatus | null {
  return normalizeToStatus(decisionOrStatus);
}

