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
      if (typeof v === 'undefined') continue; // stable stringify semantics
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  return JSON.stringify(value);
}

function computeStage6ContentHash({ scope, title, description }) {
  // Must match Stage 6 backend computeContentHash for actions = [].
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

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log(`Running Stage 7 smoke tests against ${BASE_URL}`);

    // Test author keypair
    const keypair = nacl.sign.keyPair();
    const authorPubkey = bs58.encode(keypair.publicKey);

    // Create proposal via Stage 6 submit first to populate Proposal.contentHash.
    const scope = 'GLOBAL';
    const title = 'Stage7 proposal';
    const description = 'Stage7 contentHash';

    const contentHash = computeStage6ContentHash({ scope, title, description });
    const submitSignature = signMessage(keypair.secretKey, `diploma-z96a propose:${contentHash}`);

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

    const { res: submitRes, body: submitBody } = await request(`/api/proposals/${proposal.id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ contentHash, signature: submitSignature }),
    });

    assert(submitRes.status === 200, `Expected 200 from /submit, got ${submitRes.status}`);
    assert(submitBody && typeof submitBody.txSignature === 'string', 'Expected txSignature string from /submit');

    const proposalAfterSubmit = await prisma.proposal.findUnique({
      where: { id: proposal.id },
      select: { id: true, status: true, contentHash: true },
    });
    assert(proposalAfterSubmit, 'Proposal must exist');
    assert(proposalAfterSubmit.contentHash, 'Proposal.contentHash must be set after /submit');
    const contentHashFromDb = proposalAfterSubmit.contentHash;

    // Stage 7: actions can be added in DRAFT
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'DRAFT' },
    });

    // Create test NetworkProvider for element creation
    const provider = await prisma.networkProvider.create({
      data: { name: `stage7-provider-${Date.now()}`, scope: 'GLOBAL' },
      select: { id: true },
    });

    // Prepare CREATE ChangeAction payload
    const sourceId = `stage7-element-${Date.now()}`;
    const elementPayload = {
      scope: 'GLOBAL',
      type: 'BASE_STATION',
      providerId: provider.id,
      name: 'Stage7 created element',
      sourceId,
      lat: 10.123,
      lng: 20.456,
      altitude: 30.789,
      path: null,
      metadata: { note: 'stage7-test' },
    };

    // 1) POST /actions valid
    const addActionSignature = signMessage(keypair.secretKey, `diploma-z96a action:add:${proposal.id}`);

    const { res: actionsOkRes, body: actionsOkBody } = await request(
      `/api/proposals/${proposal.id}/actions`,
      {
        method: 'POST',
        body: JSON.stringify({
          signature: addActionSignature,
          actionType: 'CREATE',
          elementPayload,
          targetElementId: null,
        }),
      },
    );

    assert(actionsOkRes.status === 200, `Expected 200 from /actions (valid payload), got ${actionsOkRes.status}`);
    assert(actionsOkBody && actionsOkBody.ok === true, 'Expected { ok: true } from /actions');
    assert(typeof actionsOkBody.actionId === 'string' && actionsOkBody.actionId.length > 0, 'Expected actionId string');

    // 2) POST /actions invalid payload
    const { res: actionsBadRes } = await request(`/api/proposals/${proposal.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        signature: addActionSignature,
        actionType: 'BAD_ACTION_TYPE',
        elementPayload,
      }),
    });
    assert(actionsBadRes.status === 400, `Expected 400 from /actions (invalid actionType), got ${actionsBadRes.status}`);

    // Apply: move proposal to ACCEPTED
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'ACCEPTED' },
    });

    // 3) POST /apply
    const applySignature = signMessage(
      keypair.secretKey,
      `diploma-z96a propose:apply:${proposal.id}:${contentHashFromDb}`,
    );

    const { res: applyRes, body: applyBody } = await request(`/api/proposals/${proposal.id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ signature: applySignature }),
    });

    assert(applyRes.status === 200, `Expected 200 from /apply, got ${applyRes.status}`);
    assert(applyBody && applyBody.ok === true, 'Expected { ok: true } from /apply');
    assert(typeof applyBody.historyId === 'string' && applyBody.historyId.length > 0, 'Expected historyId string');

    // Validate HistoryEntry exists
    const history = await prisma.historyEntry.findUnique({
      where: { id: applyBody.historyId },
      select: { id: true, proposalId: true, actionId: true, appliedAt: true, diff: true },
    });
    assert(history, 'HistoryEntry must be created by /apply');
    assert(history.proposalId === proposal.id, 'HistoryEntry must reference the proposal');

    // Validate NetworkElement created
    const created = await prisma.networkElement.findUnique({
      where: { sourceId },
      select: { id: true, sourceId: true, lat: true, lng: true, type: true },
    });
    assert(created, 'NetworkElement must be created by /apply');

    // 4) GET /history contains new entry
    const { res: historyRes, body: historyList } = await request(`/api/proposals/${proposal.id}/history`, {
      method: 'GET',
    });
    assert(historyRes.status === 200, `Expected 200 from /history, got ${historyRes.status}`);
    assert(Array.isArray(historyList), 'Expected array from /history');
    assert(
      historyList.some((x) => x.id === applyBody.historyId),
      'Expected /history response to contain created historyId',
    );

    // 5) POST /rollback
    const rollbackSignature = signMessage(
      keypair.secretKey,
      `diploma-z96a propose:rollback:${proposal.id}:${applyBody.historyId}`,
    );

    const { res: rollbackRes, body: rollbackBody } = await request(`/api/proposals/${proposal.id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ signature: rollbackSignature }),
    });

    assert(rollbackRes.status === 200, `Expected 200 from /rollback, got ${rollbackRes.status}`);
    assert(rollbackBody && rollbackBody.ok === true, 'Expected { ok: true } from /rollback');

    const rolled = await prisma.networkElement.findUnique({
      where: { sourceId },
      select: { id: true },
    });
    assert(!rolled, 'NetworkElement must be removed after rollback (CREATE action)');

    console.log('Stage 7 smoke tests passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Stage 7 smoke tests failed:', err);
  process.exit(1);
});

