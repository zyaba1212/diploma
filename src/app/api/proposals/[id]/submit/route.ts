// HTTP API /api/proposals/[id]/submit — Next.js Route Handler.

import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { prisma } from '@/lib/prisma';
import { createHash } from 'node:crypto';
import type { ChangeActionType, ProposalStatus } from '@prisma/client';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { logApiMetric } from '@/lib/apiOps';
import { internalApiError } from '@/lib/apiError';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type Body = {
  // hex/base16 content hash in the same format used by backend computation
  contentHash?: string;
  // base58 signature of message diploma-z96a propose:<contentHash>
  signature: string;
};

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function sha256Hex(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
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
      if (typeof v === 'undefined') continue; // stable stringify semantics (same as JSON stringify)
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  // Fallback for unsupported types (shouldn't happen for Prisma Json payloads).
  return JSON.stringify(value);
}

function computeContentHash(input: {
  proposalFields: { scope: string; title?: string; description?: string };
  actions: Array<{
    actionType: ChangeActionType;
    targetElementId?: string;
    elementPayload: unknown;
  }>;
}) {
  return sha256Hex(
    stableStringify({
      proposalFields: {
        scope: input.proposalFields.scope,
        ...(typeof input.proposalFields.title !== 'undefined' ? { title: input.proposalFields.title } : {}),
        ...(typeof input.proposalFields.description !== 'undefined'
          ? { description: input.proposalFields.description }
          : {}),
      },
      actions: input.actions.map((a) => ({
        actionType: a.actionType,
        ...(typeof a.targetElementId !== 'undefined' ? { targetElementId: a.targetElementId } : {}),
        elementPayload: a.elementPayload,
      })),
    }),
  );
}

function readPayerKeypair(): Keypair | null {
  const rawB58 = process.env.SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58 || process.env.SOLANA_SUBMISSION_PAYER_PRIVATE_KEY;
  if (!rawB58) return null;

  // Support either base58 secret key bytes or JSON array of bytes.
  const trimmed = rawB58.trim();
  try {
    if (trimmed.startsWith('[')) {
      const arr = JSON.parse(trimmed) as number[];
      const u8 = new Uint8Array(arr);
      if (u8.length === 64) return Keypair.fromSecretKey(u8);
      return Keypair.fromSeed(u8);
    }

    const decoded = bs58.decode(trimmed);
    const u8 = new Uint8Array(decoded);
    if (u8.length === 64) return Keypair.fromSecretKey(u8);
    if (u8.length === 32) return Keypair.fromSeed(u8);
    return null;
  } catch {
    return null;
  }
}

async function sendMemoTx(message: string): Promise<string> {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC || process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL is not configured');

  const payer = readPayerKeypair();
  if (!payer) throw new Error('SOLANA_SUBMISSION_PAYER_PRIVATE_KEY is not configured');

  const connection = new Connection(rpcUrl, 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
  tx.add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(message, 'utf8'),
    }),
  );

  tx.sign(payer);

  const txSignature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  // Best-effort confirmation: endpoint fails if tx execution fails.
  await connection.confirmTransaction(
    { signature: txSignature, blockhash, lastValidBlockHeight },
    'confirmed',
  );

  return txSignature;
}

function isProposalStatus(value: unknown): value is ProposalStatus {
  return value === 'DRAFT' || value === 'SUBMITTED' || value === 'ACCEPTED' || value === 'REJECTED';
}

export async function POST(req: Request, { params }: Params) {
  const started = Date.now();
  const tooBig = assertBodySizeWithin(req, 200_000);
  if (tooBig) return tooBig;
  const { id } = await params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const signature = typeof body.signature === 'string' ? body.signature : '';
  const requestedContentHash = typeof body.contentHash === 'string' ? body.contentHash : undefined;

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.submit:${clientIp}`, 15, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      authorPubkey: true,
      scope: true,
      title: true,
      description: true,
      contentHash: true,
      signature: true,
      onChainTxSignature: true,
      onChainSubmittedAt: true,
      actions: {
        orderBy: { createdAt: 'asc' },
        select: {
          actionType: true,
          targetElementId: true,
          elementPayload: true,
        },
      },
    },
  });

  if (!proposal) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (!isProposalStatus(proposal.status)) {
    return NextResponse.json({ error: 'invalid proposal status' }, { status: 400 });
  }

  if (proposal.status !== 'SUBMITTED') {
    return NextResponse.json({ error: 'proposal must be in SUBMITTED status' }, { status: 400 });
  }

  const proposalFields: { scope: string; title?: string; description?: string } = { scope: proposal.scope };
  if (proposal.title != null) proposalFields.title = proposal.title;
  if (proposal.description != null) proposalFields.description = proposal.description;

  const actions = proposal.actions.map((a) => ({
    actionType: a.actionType,
    elementPayload: a.elementPayload,
    ...(a.targetElementId != null ? { targetElementId: a.targetElementId } : {}),
  }));

  const computedContentHash = computeContentHash({ proposalFields, actions });

  const storedContentHash = proposal.contentHash ?? null;
  if (storedContentHash && storedContentHash.toLowerCase() !== computedContentHash.toLowerCase()) {
    return NextResponse.json({ error: 'contentHash mismatch' }, { status: 400 });
  }
  if (requestedContentHash && requestedContentHash.toLowerCase() !== computedContentHash.toLowerCase()) {
    return NextResponse.json({ error: 'contentHash mismatch' }, { status: 400 });
  }

  const expectedMessage = `diploma-z96a propose:${computedContentHash}`;
  let sigBytes: Uint8Array;
  let pkBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
    pkBytes = bs58.decode(proposal.authorPubkey);
  } catch {
    return NextResponse.json({ error: 'invalid base58 signature or pubkey' }, { status: 400 });
  }

  const msgBytes = new TextEncoder().encode(expectedMessage);
  const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
  if (!ok) {
    return NextResponse.json({ error: 'signature invalid' }, { status: 400 });
  }

  if (await isUserBanned(proposal.authorPubkey)) {
    return userBannedResponsePlain();
  }

  // If it is already submitted on-chain, don't re-submit; still validated signature above.
  if (proposal.onChainTxSignature && proposal.onChainSubmittedAt) {
    logApiMetric({
      route: '/api/proposals/:id/submit',
      method: 'POST',
      status: 200,
      durationMs: Date.now() - started,
      ok: true,
      note: 'already_submitted',
    });
    return NextResponse.json(
      { txSignature: proposal.onChainTxSignature },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    let txSignature: string;
    if (process.env.NODE_ENV !== 'production') {
      txSignature = `dev-tx-${computedContentHash.slice(0, 12)}`;
    } else {
      txSignature = await sendMemoTx(expectedMessage);
    }

    const updated = await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: 'SUBMITTED',
        contentHash: computedContentHash,
        signature,
        onChainTxSignature: txSignature,
        onChainSubmittedAt: new Date(),
      },
      select: {
        id: true,
        onChainTxSignature: true,
        onChainSubmittedAt: true,
      },
    });

    logApiMetric({
      route: '/api/proposals/:id/submit',
      method: 'POST',
      status: 200,
      durationMs: Date.now() - started,
      ok: true,
    });
    return NextResponse.json(
      {
        txSignature: updated.onChainTxSignature,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    logApiMetric({
      route: '/api/proposals/:id/submit',
      method: 'POST',
      status: 502,
      durationMs: Date.now() - started,
      ok: false,
      note: message || 'submit_failed',
    });
    // Don't leak stack traces.
    if (message.includes('not configured')) {
      return internalApiError(message || 'solana not configured', 502);
    }
    return internalApiError('on-chain submission failed', 502);
  }
}

