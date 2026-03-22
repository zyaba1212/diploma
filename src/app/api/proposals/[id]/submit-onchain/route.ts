import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma';

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type Body = {
  contentHash?: string;
  signature?: string; // base58
};

function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable stringify:
 * - object keys are sorted lexicographically
 * - arrays keep order
 * - skips `undefined` keys (like JSON.stringify)
 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }

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

  // Fallback for unsupported types (e.g. functions) to JSON.stringify semantics.
  return JSON.stringify(value);
}

function computeExpectedContentHash(proposal: {
  scope: string;
  title: string | null;
  description: string | null;
}) {
  const proposalFields: Record<string, unknown> = {
    scope: proposal.scope,
  };
  if (proposal.title != null) proposalFields.title = proposal.title;
  if (proposal.description != null) proposalFields.description = proposal.description;

  const stable = stableStringify({ proposalFields, actions: [] });
  return sha256Hex(stable);
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const contentHash = body.contentHash;
  const signature = body.signature;

  if (!contentHash || typeof contentHash !== 'string') {
    return NextResponse.json({ error: 'Invalid or missing "contentHash"' }, { status: 400 });
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Invalid or missing "signature"' }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true, status: true, authorPubkey: true, scope: true, title: true, description: true },
  });

  if (!proposal) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (proposal.status !== 'SUBMITTED') {
    return NextResponse.json({ error: 'Proposal must be in SUBMITTED status' }, { status: 400 });
  }

  // Stage 5 minimum does not store contentHash/signature in DB yet.
  // Backend recomputes expected hash from current Proposal fields and validates request hash/signature.
  const expectedContentHash = computeExpectedContentHash({
    scope: proposal.scope,
    title: proposal.title,
    description: proposal.description,
  });

  if (contentHash !== expectedContentHash) {
    return NextResponse.json({ error: 'contentHash mismatch' }, { status: 400 });
  }

  const message = `diploma-z96a propose:${expectedContentHash}`;

  let sigBytes: Uint8Array;
  let pkBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
    pkBytes = bs58.decode(proposal.authorPubkey);
  } catch {
    return NextResponse.json({ error: 'Invalid base58 signature/pubkey' }, { status: 400 });
  }

  const msgBytes = new TextEncoder().encode(message);
  const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
  if (!ok) {
    return NextResponse.json({ error: 'signature invalid' }, { status: 401 });
  }

  // Dev/stub behavior: we don't send real Anchor tx yet.
  if (process.env.NODE_ENV !== 'production') {
    const txSignature = `dev-tx-${expectedContentHash.slice(0, 12)}`;
    return NextResponse.json({ ok: true, txSignature }, { status: 200 });
  }

  // Production on-chain integration is planned (Stage 6 full implementation).
  return NextResponse.json(
    { error: 'On-chain submission not implemented in production yet' },
    { status: 501 },
  );
}

