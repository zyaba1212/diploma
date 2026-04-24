// HTTP API /api/proposals/[id]/actions — Next.js Route Handler.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ChangeActionType, Prisma } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { buildNetworkElementCreateData, buildNetworkElementUpdateData, isNetworkElementType } from '@/lib/stage7/networkElementOps';
import { internalApiError } from '@/lib/apiError';
import { assertBodySizeWithin } from '@/lib/bodySizeGuard';
import { isUserBanned, userBannedResponsePlain } from '@/lib/user-ban';
import { canAppendSingleChangeAction } from '@/lib/stage7/proposalMutationPolicy';

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type Body = {
  signature?: string;
  actionType: ChangeActionType;
  targetElementId?: string;
  elementPayload: unknown;
  reversePayload?: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const tooBig = assertBodySizeWithin(req, 200_000);
  if (tooBig) return tooBig;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`proposals.actions:${clientIp}`, 200, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const actionType = body.actionType;
  const targetElementId = typeof body.targetElementId === 'string' ? body.targetElementId : undefined;
  const elementPayload = body.elementPayload;
  const reversePayload = typeof body.reversePayload === 'undefined' ? undefined : body.reversePayload;
  const signature = typeof body.signature === 'string' ? body.signature : '';

  const actionTypeStr = typeof actionType === 'string' ? actionType : '';
  const VALID_ACTION_TYPES: ChangeActionType[] = ['CREATE', 'UPDATE', 'DELETE'];

  if (!actionTypeStr) {
    return NextResponse.json({ error: 'invalid actionType' }, { status: 400 });
  }
  if (!VALID_ACTION_TYPES.includes(actionTypeStr as ChangeActionType)) {
    return NextResponse.json({ error: 'invalid actionType' }, { status: 400 });
  }

  if (!isPlainObject(elementPayload)) {
    return NextResponse.json({ error: 'elementPayload must be an object' }, { status: 400 });
  }

  // Basic size guard: avoid extremely large payloads.
  const payloadBytes = Buffer.byteLength(JSON.stringify(elementPayload));
  if (payloadBytes > 50_000) {
    return NextResponse.json({ error: 'elementPayload too large' }, { status: 400 });
  }

  // Basic elementPayload validation depending on action type.
  const maybeType = (elementPayload as Record<string, unknown>).type;
  if (typeof maybeType !== 'undefined') {
    if (!isNetworkElementType(maybeType)) {
      return NextResponse.json({ error: 'invalid elementPayload.type' }, { status: 400 });
    }
  }

  if (actionTypeStr === 'UPDATE') {
    if (!targetElementId) return NextResponse.json({ error: 'targetElementId required for UPDATE' }, { status: 400 });
    const updateData = buildNetworkElementUpdateData(elementPayload);
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'empty elementPayload for UPDATE' }, { status: 400 });
    }
  }

  if (actionTypeStr === 'DELETE') {
    if (!targetElementId) return NextResponse.json({ error: 'targetElementId required for DELETE' }, { status: 400 });
    // For DELETE, elementPayload is not used by apply in v1, but still keep basic validation.
  }

  if (typeof reversePayload !== 'undefined' && !isPlainObject(reversePayload)) {
    return NextResponse.json({ error: 'reversePayload must be an object' }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { id: true, status: true, scope: true, authorPubkey: true },
  });

  if (!proposal) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (proposal.status === 'REJECTED' || proposal.status === 'APPLIED' || proposal.status === 'CANCELLED') {
    return NextResponse.json({ error: 'proposal cannot be modified in this status' }, { status: 409 });
  }
  if (!canAppendSingleChangeAction(proposal.status)) {
    return NextResponse.json(
      {
        error:
          'single ChangeAction append is allowed only for DRAFT; use POST /api/proposals/:id/sync-actions to replace the sandbox set on SUBMITTED (no votes, no chain tx)',
      },
      { status: 409 },
    );
  }

  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  // Signature check: authorPubkey signs `diploma-z96a action:add:<proposalId>`.
  // Stage 8 expects invalid signature => 401 and no action creation.
  const expectedMessage = `diploma-z96a action:add:${id}`;
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
    return NextResponse.json({ error: 'signature invalid' }, { status: 401 });
  }

  if (await isUserBanned(proposal.authorPubkey)) {
    return userBannedResponsePlain();
  }

  try {
    if (actionTypeStr === 'CREATE') {
      // Validate that CREATE payload can be translated into NetworkElement fields.
      try {
        buildNetworkElementCreateData({ proposalScope: proposal.scope, payload: elementPayload });
      } catch {
        return NextResponse.json({ error: 'invalid elementPayload for CREATE' }, { status: 400 });
      }
    }

    const created = await prisma.changeAction.create({
      data: {
        proposalId: proposal.id,
        actionType: actionTypeStr as ChangeActionType,
        targetElementId: targetElementId ?? null,
        elementPayload: elementPayload as Prisma.InputJsonObject,
        ...(reversePayload === undefined
          ? {}
          : { reversePayload: reversePayload as Prisma.InputJsonObject }),
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, actionId: created.id }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return internalApiError('failed to create action', 500);
  }
}

