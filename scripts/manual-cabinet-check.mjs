/* eslint-disable no-console */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const kp = nacl.sign.keyPair();
  const pubkey = bs58.encode(kp.publicKey);

  const username1 = `cab_${Date.now().toString().slice(-10)}`;
  assert(username1.length >= 3 && username1.length <= 32, 'username1 length must be 3–32');

  // Must match src/lib/username.ts: buildUsernameMessage()
  const ts1 = new Date().toISOString();
  const message1 = `diploma-z96a username\npubkey=${pubkey}\nusername=${username1}\nts=${ts1}`;
  const signature1Bytes = nacl.sign.detached(new TextEncoder().encode(message1), kp.secretKey);
  const signature1 = bs58.encode(signature1Bytes);

  const r1 = await fetch(`${BASE_URL}/api/profile?pubkey=${pubkey}`);
  const b1 = await r1.json();
  assert(r1.status === 200, `GET /api/profile status ${r1.status}`);
  assert(b1.inDatabase === false, 'expected inDatabase=false before set');

  const r2 = await fetch(`${BASE_URL}/api/profile/username`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: pubkey, message: message1, signature: signature1, username: username1 }),
  });
  const b2 = await r2.json();
  assert(r2.status === 200, `POST /api/profile/username status ${r2.status}; body=${JSON.stringify(b2)}`);
  assert(b2.ok === true, 'expected ok=true');

  const r3 = await fetch(`${BASE_URL}/api/profile?pubkey=${pubkey}`);
  const b3 = await r3.json();
  assert(r3.status === 200, `GET /api/profile after set status ${r3.status}`);
  assert(b3.inDatabase === true, 'expected inDatabase=true after set');
  assert(b3.username === username1, 'username mismatch after set');

  // Second set attempt with another username should succeed (username can be changed after set).
  const username2 = `cab_${(Date.now() + 1).toString().slice(-10)}`;
  const ts2 = new Date().toISOString();
  const message2 = `diploma-z96a username\npubkey=${pubkey}\nusername=${username2}\nts=${ts2}`;
  const signature2Bytes = nacl.sign.detached(new TextEncoder().encode(message2), kp.secretKey);
  const signature2 = bs58.encode(signature2Bytes);

  const r4 = await fetch(`${BASE_URL}/api/profile/username`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: pubkey, message: message2, signature: signature2, username: username2 }),
  });
  const b4 = await r4.json();
  assert(r4.status === 200, `expected 200 on changing username after set, got ${r4.status}; body=${JSON.stringify(b4)}`);
  assert(b4.ok === true, `expected ok=true on second username change; body=${JSON.stringify(b4)}`);

  const r5 = await fetch(`${BASE_URL}/api/profile?pubkey=${pubkey}`);
  const b5 = await r5.json();
  assert(r5.status === 200, `GET /api/profile after 2nd set status ${r5.status}`);
  assert(b5.username === username2, 'username mismatch after 2nd set');
  assert(typeof b5.usernameSetAt === 'string' && b5.usernameSetAt.length > 0, 'expected usernameSetAt non-null after 2nd set');

  const rCab = await fetch(`${BASE_URL}/cabinet`);
  const html = await rCab.text();
  assert(rCab.status === 200, `GET /cabinet status ${rCab.status}`);
  assert(html.length > 500, 'cabinet page render seems too small');

  console.log('manual-cabinet-check: OK');
}

main().catch((err) => {
  console.error('manual-cabinet-check failed:', err);
  process.exit(1);
});

