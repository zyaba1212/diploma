/* eslint-disable no-console */
/**
 * Smoke: ProposalRevision API + fork (requires dev server + DB migrations applied).
 * Run: npm run dev (other terminal) → npm run test:proposals-revisions
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

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

function sign(secretKey, message) {
  const msgBytes = new TextEncoder().encode(message);
  return bs58.encode(nacl.sign.detached(msgBytes, secretKey));
}

async function main() {
  console.log(`Revisions smoke against ${BASE_URL}`);
  const kp = nacl.sign.keyPair();
  const authorPubkey = bs58.encode(kp.publicKey);

  const { res: cRes, body: created } = await request('/api/proposals', {
    method: 'POST',
    body: JSON.stringify({
      scope: 'GLOBAL',
      authorPubkey,
      title: 'Rev smoke',
      description: 'test',
    }),
  });
  assert(cRes.ok, `create proposal ${cRes.status} ${JSON.stringify(created)}`);
  const proposalId = created.id;
  assert(proposalId, 'proposal id');

  const addSig = sign(kp.secretKey, `diploma-z96a action:add:${proposalId}`);
  const payload = {
    type: 'SERVER',
    scope: 'GLOBAL',
    name: 'n1',
    lat: 53.9,
    lng: 27.56,
  };
  const { res: aRes } = await request(`/api/proposals/${proposalId}/actions`, {
    method: 'POST',
    body: JSON.stringify({
      actionType: 'CREATE',
      elementPayload: payload,
      signature: addSig,
    }),
  });
  assert(aRes.ok, `add action ${aRes.status}`);

  const { res: sdRes } = await request(`/api/proposals/${proposalId}/submit-draft`, {
    method: 'POST',
    body: JSON.stringify({ authorPubkey }),
  });
  assert(sdRes.ok, `submit-draft ${sdRes.status}`);

  const creates = [
    {
      type: 'SERVER',
      scope: 'GLOBAL',
      name: 'n1',
      lat: 53.91,
      lng: 27.57,
    },
  ];
  const revSig = sign(kp.secretKey, `diploma-z96a propose:revision:${proposalId}:null`);
  const { res: rRes, body: rBody } = await request(`/api/proposals/${proposalId}/revisions`, {
    method: 'POST',
    body: JSON.stringify({
      signature: revSig,
      baseRevisionId: null,
      message: 'Move node slightly',
      creates,
    }),
  });
  assert(rRes.ok, `revisions POST ${rRes.status} ${JSON.stringify(rBody)}`);
  assert(rBody.headRevisionId, 'headRevisionId in response');

  const { res: listRes, body: list } = await request(`/api/proposals/${proposalId}/revisions`);
  assert(listRes.ok, `revisions list ${listRes.status}`);
  assert(Array.isArray(list) && list.length >= 2, `expected >=2 revisions got ${list?.length}`);

  const forkCreates = [
    { type: 'SERVER', scope: 'GLOBAL', name: 'fork-node', lat: 54, lng: 28 },
  ];
  const forkSig = sign(kp.secretKey, `diploma-z96a propose:fork:${proposalId}`);
  const { res: fRes, body: fBody } = await request(`/api/proposals/${proposalId}/fork`, {
    method: 'POST',
    body: JSON.stringify({
      authorPubkey,
      signature: forkSig,
      title: 'Fork rev smoke',
      description: 'forked',
      message: 'Fork commit',
      creates: forkCreates,
    }),
  });
  assert(fRes.ok, `fork ${fRes.status} ${JSON.stringify(fBody)}`);
  const forkId = fBody.proposal?.id;
  assert(forkId, 'fork proposal id');

  const { res: forkGetRes, body: forkGet } = await request(`/api/proposals/${forkId}`);
  assert(forkGetRes.ok, `fork get ${forkGetRes.status}`);
  assert(forkGet.forkedFromProposalId === proposalId, 'forkedFromProposalId must point to source');

  const { res: listApiRes, body: listApi } = await request('/api/proposals?authorPubkey=' + encodeURIComponent(authorPubkey));
  assert(listApiRes.ok, `proposals list ${listApiRes.status}`);
  const sourceRow = Array.isArray(listApi) ? listApi.find((p) => p.id === proposalId) : null;
  assert(sourceRow, 'source proposal must be present in list');
  assert((sourceRow._count?.revisions ?? 0) >= 1, 'source proposal should expose revisions count');

  console.log('OK — revisions + fork');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
