import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createHash } from 'node:crypto';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';

type Params = { params: Promise<{ id: string }> };

function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(v => stableStringify(v)).join(',')}]`;
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'undefined') continue;
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function POST(req: Request, { params }: Params) {
  const tooBig = assertBodySizeWithin(req, 10_000);
  if (tooBig) return tooBig;
  const { id } = await params;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.submitDraft:${clientIp}`, 15, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  let body: { authorPubkey?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const authorPubkey = typeof body.authorPubkey === 'string' ? body.authorPubkey.trim() : '';
  if (!authorPubkey) return NextResponse.json({ error: 'authorPubkey required' }, { status: 400 });

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: {
      id: true, status: true, authorPubkey: true, scope: true, title: true, description: true,
      actions: { orderBy: { createdAt: 'asc' }, select: { actionType: true, targetElementId: true, elementPayload: true } },
    },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (proposal.authorPubkey !== authorPubkey) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (proposal.status !== 'DRAFT') return NextResponse.json({ error: 'proposal must be DRAFT' }, { status: 400 });
  if (proposal.actions.length === 0) return NextResponse.json({ error: 'proposal must have at least one action' }, { status: 400 });

  const proposalFields: Record<string, string> = { scope: proposal.scope };
  if (proposal.title != null) proposalFields.title = proposal.title;
  if (proposal.description != null) proposalFields.description = proposal.description;

  const actions = proposal.actions.map(a => ({
    actionType: a.actionType,
    elementPayload: a.elementPayload,
    ...(a.targetElementId != null ? { targetElementId: a.targetElementId } : {}),
  }));

  const contentHash = sha256Hex(stableStringify({ proposalFields, actions }));

  const votingEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const updated = await prisma.proposal.update({
    where: { id },
    data: { status: 'SUBMITTED', submittedAt: new Date(), contentHash, votingEndsAt },
    select: { id: true, status: true, contentHash: true, votingEndsAt: true },
  });

  return NextResponse.json(updated, { status: 200, headers: { 'cache-control': 'no-store' } });
}
