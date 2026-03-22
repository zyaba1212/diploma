/* eslint-disable no-console */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function main() {
  const kp = nacl.sign.keyPair();
  const pubkey = bs58.encode(kp.publicKey);
  const otherKp = nacl.sign.keyPair();
  const otherPubkey = bs58.encode(otherKp.publicKey);

  // 1) Auth verify should create user with random username.
  const ts0 = new Date().toISOString();
  const authMessage = `diploma-z96a auth\npubkey=${pubkey}\nts=${ts0}`;
  const authSigBytes = nacl.sign.detached(new TextEncoder().encode(authMessage), kp.secretKey);
  const authSignature = bs58.encode(authSigBytes);

  const r0 = await postJson(`${BASE_URL}/api/auth/verify`, {
    publicKey: pubkey,
    message: authMessage,
    signature: authSignature,
  });
  assert(r0.res.status === 200 && r0.json?.ok === true, `POST /api/auth/verify failed: ${r0.res.status}; body=${JSON.stringify(r0.json)}`);

  // 2) Profile should exist and usernameSetAt should be null.
  const r1 = await fetch(`${BASE_URL}/api/profile?pubkey=${encodeURIComponent(pubkey)}`);
  const b1 = await r1.json();
  assert(r1.status === 200, `GET /api/profile status ${r1.status}`);
  assert(b1.inDatabase === true, 'expected inDatabase=true');
  assert(typeof b1.username === 'string' && b1.username.length >= 3, 'expected username string after verify');
  assert(b1.usernameSetAt === null, 'expected usernameSetAt=null for auto-generated username');

  const username1 = b1.username;

  // 2b) Bulk endpoint should resolve usernames for known pubkeys.
  const bulk1 = await postJson(`${BASE_URL}/api/profile/bulk`, { pubkeys: [pubkey, otherPubkey] });
  assert(bulk1.res.status === 200 && bulk1.json?.ok === true, `POST /api/profile/bulk failed: ${bulk1.res.status}; body=${JSON.stringify(bulk1.json)}`);
  assert(bulk1.json.usernamesByPubkey?.[pubkey] === username1, 'bulk should include username1');
  assert(bulk1.json.usernamesByPubkey?.[otherPubkey] === null, 'bulk unknown pubkey should be null');

  // 3) User should be able to override username while usernameSetAt===null.
  const username2 = `cab_${(Date.now() + 1).toString().slice(-10)}`;
  const ts2 = new Date().toISOString();
  const message2 = `diploma-z96a username\npubkey=${pubkey}\nusername=${username2}\nts=${ts2}`;
  const sig2Bytes = nacl.sign.detached(new TextEncoder().encode(message2), kp.secretKey);
  const sig2 = bs58.encode(sig2Bytes);

  const r2 = await postJson(`${BASE_URL}/api/profile/username`, {
    publicKey: pubkey,
    message: message2,
    signature: sig2,
    username: username2,
  });
  assert(r2.res.status === 200 && r2.json?.ok === true, `POST /api/profile/username failed: ${r2.res.status}; body=${JSON.stringify(r2.json)}`);

  const r3 = await fetch(`${BASE_URL}/api/profile?pubkey=${encodeURIComponent(pubkey)}`);
  const b3 = await r3.json();
  assert(r3.status === 200, `GET /api/profile after override status ${r3.status}`);
  assert(b3.username === username2, 'username must be overridden');
  assert(typeof b3.usernameSetAt === 'string' && b3.usernameSetAt.length > 0, 'expected usernameSetAt non-null after override');

  // 4) Re-changing should be allowed.
  const username3 = `cab_${(Date.now() + 2).toString().slice(-10)}`;
  const ts3 = new Date().toISOString();
  const message3 = `diploma-z96a username\npubkey=${pubkey}\nusername=${username3}\nts=${ts3}`;
  const sig3Bytes = nacl.sign.detached(new TextEncoder().encode(message3), kp.secretKey);
  const sig3 = bs58.encode(sig3Bytes);

  const r4 = await postJson(`${BASE_URL}/api/profile/username`, {
    publicKey: pubkey,
    message: message3,
    signature: sig3,
    username: username3,
  });
  assert(r4.res.status === 200, `expected 200 on changing username after set; got ${r4.res.status}; body=${JSON.stringify(r4.json)}`);
  assert(r4.json?.ok === true, `expected ok=true on second username change; body=${JSON.stringify(r4.json)}`);

  const r5 = await fetch(`${BASE_URL}/api/profile?pubkey=${encodeURIComponent(pubkey)}`);
  const b5 = await r5.json();
  assert(r5.status === 200, `GET /api/profile after 2nd change status ${r5.status}`);
  assert(b5.username === username3, 'username must update after second change');
  assert(typeof b5.usernameSetAt === 'string' && b5.usernameSetAt.length > 0, 'expected usernameSetAt non-null after 2nd change');

  // Helpful log for visibility.
  console.log('api-auth-verify-auto-username: OK', { username1, username2, username3 });
}

main().catch((err) => {
  console.error('api-auth-verify-auto-username failed:', err);
  process.exit(1);
});

