/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import crypto from 'node:crypto';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  let body;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }

  return { res, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function stableStringify(value) {
  // Match backend stableStringify semantics closely enough for our canonical inputs.
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }

  if (t === 'object') {
    const obj = value;
    const keys = Object.keys(obj).sort();
    const parts = [];
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'undefined') continue; // omit undefined keys
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  return JSON.stringify(value);
}

function computeStage6ContentHash({ scope, title, description }) {
  // Must match backend `computeContentHash` for Stage 5 minimum:
  // - actions = []
  // - title/description included only if not null in DB
  const proposalFields = { scope };
  if (title != null) proposalFields.title = title;
  if (description != null) proposalFields.description = description;

  const stable = stableStringify({ proposalFields, actions: [] });
  return sha256Hex(stable);
}

function signMessage(secretKey, message) {
  const msgBytes = new TextEncoder().encode(message);
  const signatureBytes = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(signatureBytes);
}

function asHistoryList(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.history)) return body.history;
  return [];
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log(`Running Stage 8 smoke/negative tests against ${BASE_URL}`);

    const authorKeypair = nacl.sign.keyPair();
    const invalidKeypair = nacl.sign.keyPair();
    const authorPubkey = bs58.encode(authorKeypair.publicKey);

    const scope = 'GLOBAL';
    const title = 'Stage8 proposal';
    const description = 'Stage8 contentHash';

    const contentHash = computeStage6ContentHash({ scope, title, description });
    const submitSignature = signMessage(authorKeypair.secretKey, `diploma-z96a propose:${contentHash}`);

    // Preconditions: create Proposal in SUBMITTED and submit to populate contentHash/signature/on-chain facts.
    const proposal = await prisma.proposal.create({
      data: {
        scope,
        authorPubkey,
        status: 'SUBMITTED',
        title,
        description,
      },
      select: { id: true },
    });

    const submitPayload = { contentHash, signature: submitSignature };
    const { res: submitRes, body: submitBody } = await request(`/api/proposals/${proposal.id}/submit`, {
      method: 'POST',
      body: JSON.stringify(submitPayload),
    });

    assert(submitRes.status === 200, `Expected 200 from /submit, got ${submitRes.status}; body=${JSON.stringify(submitBody)}`);

    const proposalAfterSubmit = await prisma.proposal.findUnique({
      where: { id: proposal.id },
      select: { id: true, contentHash: true },
    });

    assert(proposalAfterSubmit?.contentHash, 'Proposal.contentHash must be set after /submit');
    const contentHashFromDb = proposalAfterSubmit.contentHash;

    // Create network provider + action payload.
    await prisma.proposal.update({ where: { id: proposal.id }, data: { status: 'DRAFT' } });

    const provider = await prisma.networkProvider.create({
      data: { name: `stage8-provider-${Date.now()}`, scope: 'GLOBAL' },
      select: { id: true },
    });

    const sourceId = `stage8-element-${Date.now()}`;
    const elementPayload = {
      type: 'BASE_STATION',
      providerId: provider.id,
      name: 'Stage8 created element',
      sourceId,
      lat: 10.123,
      lng: 20.456,
      altitude: 30.789,
      path: null,
      metadata: { note: 'stage8-test' },
    };

    // Keep a stable valid signature.
    const validActionSig = signMessage(authorKeypair.secretKey, `diploma-z96a action:add:${proposal.id}`);
    const invalidActionSig = signMessage(invalidKeypair.secretKey, `diploma-z96a action:add:${proposal.id}`);

    // 1) POST /actions valid.
    const actionsBefore = await prisma.changeAction.count({ where: { proposalId: proposal.id } });
    const { res: actionsOkRes, body: actionsOkBody } = await request(`/api/proposals/${proposal.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        signature: validActionSig,
        actionType: 'CREATE',
        targetElementId: null,
        elementPayload,
      }),
    });
    assert(actionsOkRes.status === 200, `Expected 200 from /actions(valid), got ${actionsOkRes.status}; body=${JSON.stringify(actionsOkBody)}`);

    const actionsAfter = await prisma.changeAction.count({ where: { proposalId: proposal.id } });
    assert(actionsAfter === actionsBefore + 1, 'Valid /actions must create exactly one ChangeAction');

    const createdAction = await prisma.changeAction.findFirst({
      where: { proposalId: proposal.id, actionType: 'CREATE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    assert(createdAction?.id, 'ChangeAction CREATE id must exist in DB');

    // 2) POST /actions invalid payload shape.
    const { res: actionsBadPayloadRes } = await request(`/api/proposals/${proposal.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        signature: validActionSig,
        actionType: 'CREATE',
        targetElementId: null,
        elementPayload: 'not-an-object',
      }),
    });
    assert(actionsBadPayloadRes.status === 400, `Expected 400 from /actions(invalid payload), got ${actionsBadPayloadRes.status}`);

    // 3) POST /actions invalid signature.
    const actionsBeforeInvalidSig = await prisma.changeAction.count({ where: { proposalId: proposal.id } });
    const { res: actionsBadSigRes } = await request(`/api/proposals/${proposal.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        signature: invalidActionSig,
        actionType: 'CREATE',
        targetElementId: null,
        elementPayload,
      }),
    });
    assert(actionsBadSigRes.status === 401, `Expected 401 from /actions(invalid signature), got ${actionsBadSigRes.status}`);
    const actionsAfterInvalidSig = await prisma.changeAction.count({ where: { proposalId: proposal.id } });
    assert(actionsAfterInvalidSig === actionsBeforeInvalidSig, 'Invalid-signature /actions must not create actions');

    // 4) POST /actions invalid status.
    await prisma.proposal.update({ where: { id: proposal.id }, data: { status: 'APPLIED' } });
    const { res: actionsBadStatusRes } = await request(`/api/proposals/${proposal.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        signature: validActionSig,
        actionType: 'CREATE',
        targetElementId: null,
        elementPayload,
      }),
    });
    assert(actionsBadStatusRes.status === 409, `Expected 409 from /actions(invalid status), got ${actionsBadStatusRes.status}`);

    // Back to ACCEPTED for apply.
    await prisma.proposal.update({ where: { id: proposal.id }, data: { status: 'ACCEPTED' } });

    // 5) POST /apply invalid signature.
    const validApplySig = signMessage(authorKeypair.secretKey, `diploma-z96a propose:apply:${proposal.id}:${contentHashFromDb}`);
    const invalidApplySig = signMessage(invalidKeypair.secretKey, `diploma-z96a propose:apply:${proposal.id}:${contentHashFromDb}`);

    const historyCountBeforeBadApply = await prisma.historyEntry.count({ where: { proposalId: proposal.id } });
    const { res: applyBadSigRes } = await request(`/api/proposals/${proposal.id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ signature: invalidApplySig }),
    });
    assert(applyBadSigRes.status === 401, `Expected 401 from /apply(invalid signature), got ${applyBadSigRes.status}`);
    const historyCountAfterBadApply = await prisma.historyEntry.count({ where: { proposalId: proposal.id } });
    assert(historyCountAfterBadApply === historyCountBeforeBadApply, 'Invalid-signature /apply must not create history entries');

    // 6) POST /apply valid.
    const { res: applyOkRes, body: applyOkBody } = await request(`/api/proposals/${proposal.id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ signature: validApplySig }),
    });
    assert(applyOkRes.status === 200, `Expected 200 from /apply(valid), got ${applyOkRes.status}; body=${JSON.stringify(applyOkBody)}`);

    const createdHistory = await prisma.historyEntry.findFirst({
      where: { proposalId: proposal.id, actionId: createdAction.id },
      orderBy: { appliedAt: 'desc' },
      select: { id: true },
    });
    assert(createdHistory?.id, 'Valid /apply must create HistoryEntry tied to ChangeAction');
    const historyId = createdHistory.id;

    const createdElement = await prisma.networkElement.findUnique({
      where: { sourceId },
      select: { id: true },
    });
    assert(createdElement?.id, 'Valid /apply must create NetworkElement');

    // 7) GET /history includes the created entry.
    const { res: historyRes, body: historyBody } = await request(`/api/proposals/${proposal.id}/history`, {
      method: 'GET',
    });
    assert(historyRes.status === 200, `Expected 200 from /history, got ${historyRes.status}; body=${JSON.stringify(historyBody)}`);

    const historyList = asHistoryList(historyBody);
    assert(historyList.some((x) => x.id === historyId), 'GET /history must include created history entry id');

    // 8) POST /rollback invalid signature (no-op expected).
    await prisma.proposal.update({ where: { id: proposal.id }, data: { status: 'APPLIED' } });

    const rollbackHistoryCountBeforeBad = await prisma.historyEntry.count({ where: { proposalId: proposal.id } });
    const invalidRollbackSig = signMessage(
      invalidKeypair.secretKey,
      `diploma-z96a propose:rollback:${proposal.id}:${historyId}`,
    );

    const { res: rollbackBadSigRes } = await request(`/api/proposals/${proposal.id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ signature: invalidRollbackSig }),
    });
    assert(rollbackBadSigRes.status === 401, `Expected 401 from /rollback(invalid signature), got ${rollbackBadSigRes.status}`);

    const rollbackHistoryCountAfterBad = await prisma.historyEntry.count({ where: { proposalId: proposal.id } });
    assert(rollbackHistoryCountAfterBad === rollbackHistoryCountBeforeBad, 'Invalid-signature /rollback must not delete history entries');

    const elementStillThere = await prisma.networkElement.findUnique({
      where: { sourceId },
      select: { id: true },
    });
    assert(elementStillThere?.id, 'Invalid-signature /rollback must not remove NetworkElement');

    // 9) POST /rollback valid.
    const validRollbackSig = signMessage(authorKeypair.secretKey, `diploma-z96a propose:rollback:${proposal.id}:${historyId}`);

    const { res: rollbackOkRes, body: rollbackOkBody } = await request(`/api/proposals/${proposal.id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ signature: validRollbackSig }),
    });
    assert(rollbackOkRes.status === 200, `Expected 200 from /rollback(valid), got ${rollbackOkRes.status}; body=${JSON.stringify(rollbackOkBody)}`);

    const elementAfterRollback = await prisma.networkElement.findUnique({
      where: { sourceId },
      select: { id: true },
    });
    assert(!elementAfterRollback, 'Valid rollback must remove NetworkElement');

    const rollbackHistoryCountAfter = await prisma.historyEntry.count({ where: { proposalId: proposal.id } });
    assert(rollbackHistoryCountAfter === 0, 'Valid rollback must delete HistoryEntry');

    console.log('Stage 8 smoke/negative tests passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Stage 8 tests failed:', err);
  process.exit(1);
});

