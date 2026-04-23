/* eslint-disable no-console */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

function isValidUsername(u) {
  return typeof u === 'string' && USERNAME_RE.test(u);
}

function buildAuthMessage(pubkey) {
  // Must match src/components/AuthBlock.tsx and src/app/api/auth/verify/route.ts
  return `diploma-z96a auth\npubkey=${pubkey}\nts=${new Date().toISOString()}`;
}

function buildUsernameMessage(pubkey, username) {
  // Must match src/lib/username.ts: buildUsernameMessage()
  const ts = new Date().toISOString();
  return `diploma-z96a username\npubkey=${pubkey}\nusername=${username}\nts=${ts}`;
}

async function main() {
  const kp = nacl.sign.keyPair();
  const pubkey = bs58.encode(kp.publicKey);

  // 1) First login flow: POST /api/auth/verify creates random username with usernameSetAt = null.
  const authMessage = buildAuthMessage(pubkey);
  const authSigBytes = nacl.sign.detached(new TextEncoder().encode(authMessage), kp.secretKey);
  const authSignature = bs58.encode(authSigBytes);

  const r0 = await fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: pubkey, message: authMessage, signature: authSignature }),
  });
  const b0 = await r0.json();
  assert(r0.status === 200, `POST /api/auth/verify status ${r0.status}; body=${JSON.stringify(b0)}`);
  assert(b0.ok === true, 'expected ok=true from /api/auth/verify');

  const r1 = await fetch(`${BASE_URL}/api/profile?pubkey=${pubkey}`);
  const b1 = await r1.json();
  assert(r1.status === 200, `GET /api/profile status ${r1.status}; body=${JSON.stringify(b1)}`);
  assert(b1.inDatabase === true, 'expected inDatabase=true after auth verify');
  assert(b1.isBanned === false, 'expected isBanned=false for new user');
  assert(b1.usernameSetAt === null, 'expected usernameSetAt === null right after first login');
  assert(isValidUsername(b1.username), `expected username to be valid; got ${JSON.stringify(b1.username)}`);

  // 2) Username override while usernameSetAt === null.
  const username1 = `cab_${Date.now().toString().slice(-10)}`;
  assert(isValidUsername(username1), 'username1 format invalid');

  const usernameMessage1 = buildUsernameMessage(pubkey, username1);
  const usernameSigBytes1 = nacl.sign.detached(new TextEncoder().encode(usernameMessage1), kp.secretKey);
  const usernameSignature1 = bs58.encode(usernameSigBytes1);

  const r2 = await fetch(`${BASE_URL}/api/profile/username`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: pubkey,
      message: usernameMessage1,
      signature: usernameSignature1,
      username: username1,
    }),
  });
  const b2 = await r2.json();
  assert(r2.status === 200, `POST /api/profile/username status ${r2.status}; body=${JSON.stringify(b2)}`);
  assert(b2.ok === true, 'expected ok=true on username override');

  const r3 = await fetch(`${BASE_URL}/api/profile?pubkey=${pubkey}`);
  const b3 = await r3.json();
  assert(r3.status === 200, `GET /api/profile after set status ${r3.status}; body=${JSON.stringify(b3)}`);
  assert(b3.inDatabase === true, 'expected inDatabase=true after username set');
  assert(typeof b3.usernameSetAt === 'string' && b3.usernameSetAt.length > 0, 'expected usernameSetAt ISO string');
  assert(b3.username === username1, 'username mismatch after override');

  // 3) Second override attempt should be allowed.
  const username2 = `cab_${(Date.now() + 1).toString().slice(-10)}`;
  assert(isValidUsername(username2), 'username2 format invalid');

  const usernameMessage2 = buildUsernameMessage(pubkey, username2);
  const usernameSigBytes2 = nacl.sign.detached(new TextEncoder().encode(usernameMessage2), kp.secretKey);
  const usernameSignature2 = bs58.encode(usernameSigBytes2);

  const r4 = await fetch(`${BASE_URL}/api/profile/username`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: pubkey,
      message: usernameMessage2,
      signature: usernameSignature2,
      username: username2,
    }),
  });
  const b4 = await r4.json().catch(() => null);
  assert(r4.status === 200, `expected 200 on changing username after set, got ${r4.status}; body=${JSON.stringify(b4)}`);
  assert(b4?.ok === true, `expected ok=true on second username change; body=${JSON.stringify(b4)}`);

  const r5 = await fetch(`${BASE_URL}/api/profile?pubkey=${pubkey}`);
  const b5 = await r5.json();
  assert(r5.status === 200, `GET /api/profile after 2nd set status ${r5.status}; body=${JSON.stringify(b5)}`);
  assert(b5.username === username2, 'username mismatch after 2nd override');
  assert(typeof b5.usernameSetAt === 'string' && b5.usernameSetAt.length > 0, 'expected usernameSetAt non-null after 2nd override');

  console.log('api-profile-smoke: OK');
}

main().catch((err) => {
  console.error('api-profile-smoke failed:', err);
  process.exit(1);
});

