/* eslint-disable no-console */
/**
 * Smoke: admin wallet login (ADMIN_WALLET_PUBKEY + ADMIN_SMOKE_WALLET_SECRET) → CRUD ModeratorGrant →
 * extra admin API checks → optional moderator wallet login → logout.
 *
 * Skips with exit 0 if STAFF_SESSION_SECRET / ADMIN_WALLET_PUBKEY / ADMIN_SMOKE_WALLET_SECRET not set.
 *
 * ADMIN_SMOKE_WALLET_SECRET: base58 of 32-byte seed (nacl.sign.keyPair.fromSeed) or 64-byte secret key.
 *
 *   BASE_URL=http://127.0.0.1:3000 npm run test:admin-smoke
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {Response} res */
function staffCookiePairFromResponse(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    if (line.startsWith('diploma_staff_session=')) {
      return line.split(';')[0];
    }
  }
  return null;
}

function buildAuthMessage(pubkey) {
  return `diploma-z96a auth\npubkey=${pubkey}\nts=${new Date().toISOString()}`;
}

function buildAdminLoginMessage(nonce) {
  return `diploma-z96a admin-login\nnonce=${nonce}`;
}

function adminKeyPairFromSmokeSecret() {
  const raw = process.env.ADMIN_SMOKE_WALLET_SECRET?.trim();
  assert(raw, 'ADMIN_SMOKE_WALLET_SECRET empty');
  let bytes;
  try {
    bytes = bs58.decode(raw);
  } catch {
    throw new Error('ADMIN_SMOKE_WALLET_SECRET: invalid base58');
  }
  if (bytes.length === 32) {
    return nacl.sign.keyPair.fromSeed(bytes);
  }
  if (bytes.length === 64) {
    return nacl.sign.keyPair.fromSecretKey(bytes);
  }
  throw new Error(`ADMIN_SMOKE_WALLET_SECRET: expected 32 or 64 bytes after base58, got ${bytes.length}`);
}

async function walletStaffLogin(keyPair) {
  const nonceRes = await fetch(`${BASE_URL}/api/admin/auth/nonce`);
  const nonceBody = await nonceRes.json();
  assert(nonceRes.status === 200 && nonceBody.nonce, `nonce ${nonceRes.status}`);

  const pubkey = bs58.encode(keyPair.publicKey);
  const msg = buildAdminLoginMessage(nonceBody.nonce);
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), keyPair.secretKey));

  const loginRes = await fetch(`${BASE_URL}/api/admin/login/wallet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: pubkey,
      message: msg,
      signature: sig,
      nonce: nonceBody.nonce,
    }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  assert(loginRes.status === 200, `wallet login ${loginRes.status} ${JSON.stringify(loginBody)}`);

  const cookiePair = staffCookiePairFromResponse(loginRes);
  assert(cookiePair, 'missing Set-Cookie diploma_staff_session');
  return cookiePair;
}

async function main() {
  if (!process.env.STAFF_SESSION_SECRET || !process.env.ADMIN_WALLET_PUBKEY?.trim() || !process.env.ADMIN_SMOKE_WALLET_SECRET?.trim()) {
    console.log('skip admin smoke: set STAFF_SESSION_SECRET, ADMIN_WALLET_PUBKEY, ADMIN_SMOKE_WALLET_SECRET');
    process.exit(0);
  }

  const kpAdmin = adminKeyPairFromSmokeSecret();
  const adminPub = bs58.encode(kpAdmin.publicKey);
  assert(adminPub === process.env.ADMIN_WALLET_PUBKEY.trim(), 'ADMIN_SMOKE_WALLET_SECRET pubkey must match ADMIN_WALLET_PUBKEY');

  const kp = nacl.sign.keyPair();
  const pubkey = bs58.encode(kp.publicKey);
  const authMessage = buildAuthMessage(pubkey);
  const authSig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(authMessage), kp.secretKey));

  const rUser = await fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: pubkey, message: authMessage, signature: authSig }),
  });
  const bUser = await rUser.json();
  assert(rUser.status === 200, `auth/verify ${rUser.status} ${JSON.stringify(bUser)}`);

  const cookieHeader = await walletStaffLogin(kpAdmin);

  const me = await fetch(`${BASE_URL}/api/admin/me`, { headers: { cookie: cookieHeader } });
  const meBody = await me.json();
  assert(me.status === 200 && meBody.ok === true && meBody.role === 'ADMIN', `me ${me.status} ${JSON.stringify(meBody)}`);

  const usersRes = await fetch(`${BASE_URL}/api/admin/users?limit=5`, { headers: { cookie: cookieHeader } });
  const usersBody = await usersRes.json();
  assert(usersRes.status === 200, `users GET ${usersRes.status} ${JSON.stringify(usersBody)}`);
  assert(Array.isArray(usersBody.items), 'users.items');

  const statsRes = await fetch(`${BASE_URL}/api/admin/stats`, { headers: { cookie: cookieHeader } });
  assert(statsRes.status === 200, `stats ${statsRes.status}`);

  const proposalsRes = await fetch(`${BASE_URL}/api/admin/proposals?limit=1`, { headers: { cookie: cookieHeader } });
  const proposalsBody = await proposalsRes.json();
  if (proposalsRes.status === 200 && proposalsBody.items?.length > 0) {
    const pid = proposalsBody.items[0].id;
    const pinRes = await fetch(`${BASE_URL}/api/admin/proposals/${pid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ pinned: true }),
    });
    assert(pinRes.status === 200, `proposal pin ${pinRes.status}`);
    const unpinRes = await fetch(`${BASE_URL}/api/admin/proposals/${pid}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ pinned: false }),
    });
    assert(unpinRes.status === 200, `proposal unpin ${unpinRes.status}`);
  }

  const postMod = await fetch(`${BASE_URL}/api/admin/moderators`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({ pubkey }),
  });
  const postBody = await postMod.json();
  assert(postMod.status === 200, `moderators POST ${postMod.status} ${JSON.stringify(postBody)}`);

  const list = await fetch(`${BASE_URL}/api/admin/moderators`, { headers: { cookie: cookieHeader } });
  const listBody = await list.json();
  assert(list.status === 200, `moderators GET ${list.status}`);
  assert(Array.isArray(listBody.moderators), 'moderators array');
  assert(listBody.moderators.some((m) => m.pubkey === pubkey), 'expected pubkey in list');

  const banRes = await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(pubkey)}/ban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({ reason: 'smoke-test' }),
  });
  assert(banRes.status === 200, `ban ${banRes.status}`);

  const unbanRes = await fetch(`${BASE_URL}/api/admin/users/${encodeURIComponent(pubkey)}/ban`, {
    method: 'DELETE',
    headers: { cookie: cookieHeader },
  });
  assert(unbanRes.status === 200, `unban ${unbanRes.status}`);

  const adminPk = process.env.ADMIN_WALLET_PUBKEY.trim();
  if (adminPk !== pubkey) {
    const outAd = await fetch(`${BASE_URL}/api/admin/logout`, {
      method: 'POST',
      headers: { cookie: cookieHeader },
    });
    assert(outAd.status === 200, `logout admin ${outAd.status}`);

    const nonceRes = await fetch(`${BASE_URL}/api/admin/auth/nonce`);
    const nonceBody = await nonceRes.json();
    assert(nonceRes.status === 200 && nonceBody.nonce, `nonce ${nonceRes.status}`);

    const msg = buildAdminLoginMessage(nonceBody.nonce);
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));

    const wLogin = await fetch(`${BASE_URL}/api/admin/login/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publicKey: pubkey,
        message: msg,
        signature: sig,
        nonce: nonceBody.nonce,
      }),
    });
    const wBody = await wLogin.json();
    assert(wLogin.status === 200, `wallet login ${wLogin.status} ${JSON.stringify(wBody)}`);
    assert(wBody.role === 'MODERATOR', `expected MODERATOR role ${JSON.stringify(wBody)}`);

    const modCookie = staffCookiePairFromResponse(wLogin);
    assert(modCookie, 'missing mod session cookie');

    const meMod = await fetch(`${BASE_URL}/api/admin/me`, { headers: { cookie: modCookie } });
    const meModBody = await meMod.json();
    assert(meMod.status === 200 && meModBody.role === 'MODERATOR', `me mod ${meMod.status}`);

    const usersForbidden = await fetch(`${BASE_URL}/api/admin/users?limit=1`, { headers: { cookie: modCookie } });
    assert(usersForbidden.status === 403, `mod users should be 403 got ${usersForbidden.status}`);

    const outMod = await fetch(`${BASE_URL}/api/admin/logout`, {
      method: 'POST',
      headers: { cookie: modCookie },
    });
    assert(outMod.status === 200, `logout mod ${outMod.status}`);
  }

  const cookie2 = await walletStaffLogin(kpAdmin);

  const del = await fetch(`${BASE_URL}/api/admin/moderators/${encodeURIComponent(pubkey)}`, {
    method: 'DELETE',
    headers: { cookie: cookie2 },
  });
  assert(del.status === 200, `moderators DELETE ${del.status}`);

  const out = await fetch(`${BASE_URL}/api/admin/logout`, {
    method: 'POST',
    headers: { cookie: cookie2 },
  });
  assert(out.status === 200, `logout ${out.status}`);

  const me2 = await fetch(`${BASE_URL}/api/admin/me`, { headers: { cookie: cookie2 } });
  assert(me2.status === 401, 'expected 401 after logout');

  console.log('admin smoke ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
