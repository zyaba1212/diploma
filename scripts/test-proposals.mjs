/* eslint-disable no-console */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { res, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function testPostValidProposal() {
  console.log('POST /api/proposals with valid body...');
  const { res, body } = await request('/api/proposals', {
    method: 'POST',
    body: JSON.stringify({
      scope: 'GLOBAL',
      authorPubkey: 'test-author-pubkey',
      title: 'Test proposal',
      description: 'Smoke test proposal',
    }),
  });

  assert(res.status === 201, `Expected 201, got ${res.status}`);
  assert(body && body.id, 'Response must contain id');
  assert(body.status === 'DRAFT', 'New proposal must be created in DRAFT status');

  return body;
}

async function testPostInvalidProposal() {
  console.log('POST /api/proposals with invalid body (missing scope)...');
  const { res } = await request('/api/proposals', {
    method: 'POST',
    body: JSON.stringify({
      authorPubkey: 'test-author-pubkey',
    }),
  });

  assert(res.status === 400, `Expected 400, got ${res.status}`);
}

async function testGetProposalsWithFilters(createdProposal) {
  console.log('GET /api/proposals with filters...');
  const searchParams = new URLSearchParams({
    status: createdProposal.status,
    authorPubkey: createdProposal.authorPubkey,
  });
  const { res, body } = await request(`/api/proposals?${searchParams.toString()}`);

  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(Array.isArray(body), 'Response must be a ProposalDTO[] array');
  assert(
    body.some((p) => p.id === createdProposal.id),
    'Filtered list must contain created proposal',
  );
}

async function testGetProposalById(createdProposal) {
  console.log('GET /api/proposals/:id existing...');
  const { res, body } = await request(`/api/proposals/${createdProposal.id}`);

  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(body && body.id === createdProposal.id, 'Must return the same proposal');

  console.log('GET /api/proposals/:id non-existing...');
  const { res: res404 } = await request('/api/proposals/non-existing-id');
  assert(res404.status === 404, `Expected 404, got ${res404.status}`);
}

async function main() {
  console.log(`Running /api/proposals smoke tests against ${BASE_URL}`);

  const created = await testPostValidProposal();
  await testPostInvalidProposal();
  await testGetProposalsWithFilters(created);
  await testGetProposalById(created);

  console.log('All /api/proposals smoke tests passed.');
}

main().catch((err) => {
  console.error('Smoke tests failed:', err);
  process.exit(1);
});

