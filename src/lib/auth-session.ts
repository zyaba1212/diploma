/**
 * Клиентский сеанс авторизации (подпись + POST /api/auth/verify), синхронизация между вкладками.
 * Отдельно от autoconnect кошелька (см. wallet-autoconnect-policy.ts).
 */

import bs58 from 'bs58';

/** После закрытия всех вкладок: если с последнего heartbeat прошло больше — сбросить verify-сессию. */
export const AUTH_SITE_IDLE_INVALIDATE_MS = 60_000;

/** Как часто вкладка обновляет метку «сайт ещё жив» (в т.ч. в фоне, пока вкладка открыта). */
export const AUTH_HEARTBEAT_WRITE_MS = 8_000;

export const AUTH_VERIFIED_PUBKEY_KEY = 'diploma_authVerifiedPubkey';
export const AUTH_LAST_ANY_TAB_ALIVE_KEY = 'diploma_lastAnyTabAliveAt';

export const AUTH_BROADCAST_CHANNEL_NAME = 'diploma-auth';

export type AuthBroadcastPayload =
  | { type: 'auth:verified'; pubkey: string }
  | { type: 'auth:reset' };

export type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>;
export type AuthVerifyResult = 'ok' | 'banned' | 'error';

function readVerifiedPubkeyRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(AUTH_VERIFIED_PUBKEY_KEY);
  } catch {
    return null;
  }
}

function readLastAliveRaw(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = localStorage.getItem(AUTH_LAST_ANY_TAB_ALIVE_KEY);
    if (s == null) return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

function broadcastPayload(payload: AuthBroadcastPayload) {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(AUTH_BROADCAST_CHANNEL_NAME);
    ch.postMessage(payload);
    ch.close();
  } catch {
    /* ignore */
  }
}

/** Обновить метку «хотя бы одна вкладка жива» (без проверки verify). */
export function touchSitePresenceNow(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_LAST_ANY_TAB_ALIVE_KEY, String(Date.now()));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Сохранить успешный verify для pubkey и обновить presence. */
export function markVerifiedPubkey(pubkey: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_VERIFIED_PUBKEY_KEY, pubkey);
    touchSitePresenceNow();
  } catch {
    /* ignore */
  }
}

/** Только убрать verify из storage (без событий). */
export function clearVerifiedAuthStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_VERIFIED_PUBKEY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Если verify был, но давно не было ни одной живой вкладки — удалить verify.
 * @returns true, если verify был сброшен.
 */
export function purgeStaleVerifiedSession(): boolean {
  if (typeof window === 'undefined') return false;
  const verified = readVerifiedPubkeyRaw();
  if (!verified) return false;
  const last = readLastAliveRaw();
  if (last == null || Date.now() - last > AUTH_SITE_IDLE_INVALIDATE_MS) {
    clearVerifiedAuthStorage();
    return true;
  }
  return false;
}

/** Сброс клиентского сеанса + события (все вкладки). */
export function resetAuthSessionClient(): void {
  clearVerifiedAuthStorage();
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('auth:reset'));
  broadcastPayload({ type: 'auth:reset' });
}

export function emitAuthVerified(pubkey: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('auth:verified', { detail: { pubkey } }));
  broadcastPayload({ type: 'auth:verified', pubkey });
}

/**
 * Подпись сообщения авторизации и POST /api/auth/verify; при успехе — storage + события.
 */
export async function signAndVerifyAuthSession(pubkey: string, signMessage: SignMessageFn): Promise<AuthVerifyResult> {
  const message = `diploma-z96a auth\npubkey=${pubkey}\nts=${new Date().toISOString()}`;
  try {
    const encoded = new TextEncoder().encode(message);
    const signature = await signMessage(encoded);
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: pubkey, message, signature: bs58.encode(signature) }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (res.status === 403 && json.error === 'banned') {
      resetAuthSessionClient();
      return 'banned';
    }
    if (!res.ok || !json.ok) return 'error';
    markVerifiedPubkey(pubkey);
    emitAuthVerified(pubkey);
    return 'ok';
  } catch {
    return 'error';
  }
}

export function isAuthSessionVerifiedForPubkey(pubkey: string): boolean {
  if (typeof window === 'undefined') return false;
  purgeStaleVerifiedSession();
  return readVerifiedPubkeyRaw() === pubkey;
}

export function readAuthStorageKeysForSync(): readonly string[] {
  return [AUTH_VERIFIED_PUBKEY_KEY, AUTH_LAST_ANY_TAB_ALIVE_KEY] as const;
}
