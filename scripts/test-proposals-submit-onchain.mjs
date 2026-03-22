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
      if (typeof v === 'undefined') continue;
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  return JSON.stringify(value);
}

function computeExpectedContentHash(proposalFields) {
  const proposalObj = {};
  proposalObj.scope = proposalFields.scope;
  if (proposalFields.title != null) proposalObj.title = proposalFields.title;
  if (proposalFields.description != null) proposalObj.description = proposalFields.description;

  const stable = stableStringify({ proposalFields: proposalObj, actions: [] });
  return sha256Hex(stable);
}

function signMessage(secretKey, contentHash) {
  const message = `diploma-z96a propose:${contentHash}`;
  const msgBytes = new TextEncoder().encode(message);
  const signatureBytes = nacl.sign.detached(msgBytes, secretKey);
  return bs58.encode(signatureBytes);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(`Running /api/proposals/:id/submit smoke tests against ${BASE_URL}`);

    const scope = 'GLOBAL';
    const title = 'TxSignature validation';
    const description = 'dev mock tx signature';

    // Determinism: same structure => same contentHash
    const contentHashA = computeExpectedContentHash({ scope, title, description });
    const contentHashB = computeExpectedContentHash({ scope, title, description });
    assert(contentHashA === contentHashB, 'contentHash must be deterministic for identical input');

    // Valid signature scenario
    const keypairValid = nacl.sign.keyPair();
    const authorPubkeyValid = bs58.encode(keypairValid.publicKey);
    const contentHashValid = contentHashA;
    const signatureValid = signMessage(keypairValid.secretKey, contentHashValid);

    const proposalValid = await prisma.proposal.create({
      data: {
        scope,
        authorPubkey: authorPubkeyValid,
        status: 'SUBMITTED',
        title,
        description,
      },
      select: { id: true },
    });

    const { res: resOk, body: bodyOk } = await request(`/api/proposals/${proposalValid.id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ contentHash: contentHashValid, signature: signatureValid }),
    });

    assert(resOk.status === 200, `Expected 200 for valid signature, got ${resOk.status}`);
    assert(bodyOk && typeof bodyOk.txSignature === 'string' && bodyOk.txSignature.length > 10, 'Expected txSignature string in response');

    console.log('Valid signature test passed.');

    // Non-existing proposal id
    console.log('GET missing /api/proposals/:id/submit ...');
    const { res: res404 } = await request('/api/proposals/non-existing-id/submit', {
      method: 'POST',
      body: JSON.stringify({ contentHash: contentHashValid, signature: signatureValid }),
    });
    assert(res404.status === 404, `Expected 404 for non-existing proposal, got ${res404.status}`);
    console.log('Non-existing id test passed.');

    // Invalid signature scenario (signed by different keypair)
    const keypairInvalid = nacl.sign.keyPair();
    const contentHashInvalid = computeExpectedContentHash({ scope, title, description });
    const signatureInvalid = signMessage(keypairInvalid.secretKey, contentHashInvalid);

    const proposalInvalid = await prisma.proposal.create({
      data: {
        scope,
        authorPubkey: authorPubkeyValid, // author is still the valid public key
        status: 'SUBMITTED',
        title,
        description,
      },
      select: { id: true },
    });

    const { res: resBad, body: bodyBad } = await request(
      `/api/proposals/${proposalInvalid.id}/submit`,
      {
        method: 'POST',
        body: JSON.stringify({ contentHash: contentHashInvalid, signature: signatureInvalid }),
      },
    );

    assert(resBad.status === 400, `Expected 400 for invalid signature, got ${resBad.status}`);
    assert(bodyBad && bodyBad.error, 'Expected error response for invalid signature');

    console.log('Invalid signature test passed.');

    console.log('All /api/proposals/:id/submit smoke tests passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Smoke tests failed:', err);
  process.exit(1);
});

