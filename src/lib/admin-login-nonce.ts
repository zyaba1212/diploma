import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const NONCE_MAX_AGE_MS = 5 * 60 * 1000;

function getSecret(): string | null {
  const s = process.env.STAFF_SESSION_SECRET;
  return s && s.length >= 16 ? s : null;
}

/**
 * Signed nonce for Phantom admin wallet login (no server-side nonce store).
 */
export function createAdminLoginNonce(): { ok: true; nonce: string } | { ok: false; error: string } {
  const secret = getSecret();
  if (!secret) return { ok: false, error: 'server misconfigured' };

  const ts = Date.now();
  const n = randomBytes(16).toString('hex');
  const payload = `${ts}:${n}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  const nonce = `${Buffer.from(payload, 'utf8').toString('base64url')}.${sig}`;
  return { ok: true, nonce };
}

export function verifyAdminLoginNonce(nonce: string): boolean {
  const secret = getSecret();
  if (!secret) return false;

  const lastDot = nonce.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const b64 = nonce.slice(0, lastDot);
  const sig = nonce.slice(lastDot + 1);
  let payload: string;
  try {
    payload = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const ts = Number(payload.split(':')[0]);
  if (!Number.isFinite(ts)) return false;
  if (Date.now() - ts > NONCE_MAX_AGE_MS) return false;
  if (ts > Date.now() + 60_000) return false;
  return true;
}
