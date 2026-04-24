'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useRef } from 'react';
import {
  AUTH_HEARTBEAT_WRITE_MS,
  AUTH_VERIFIED_PUBKEY_KEY,
  clearVerifiedAuthStorage,
  purgeStaleVerifiedSession,
  readAuthStorageKeysForSync,
  resetAuthSessionClient,
  touchSitePresenceNow,
} from '@/lib/auth-session';

/**
 * Heartbeat «сайт жив» для всех открытых вкладок; сброс сеанса при disconnect и при протухшем verify;
 * при смене pubkey — сброс сохранённого verify (повторная авторизация только по кнопке).
 * Подпись verify не вызывается отсюда — только из UI (кнопка «Авторизоваться»).
 */
export function AuthSessionCoordinator() {
  const { connected, publicKey } = useWallet();
  const pubkey = publicKey?.toBase58() ?? null;

  const wasConnectedRef = useRef(false);

  // При первом монтировании: протухший сеанс → сброс для всех подписчиков.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (purgeStaleVerifiedSession()) {
      window.dispatchEvent(new CustomEvent('auth:reset'));
    }
  }, []);

  // Пока вкладка открыта — обновлять lastAnyTabAliveAt (в т.ч. в фоне).
  useEffect(() => {
    const tick = () => {
      touchSitePresenceNow();
    };
    tick();
    const id = window.setInterval(tick, AUTH_HEARTBEAT_WRITE_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Disconnect кошелька (включая idle) — сброс клиентской авторизации (нужна снова кнопка).
  useEffect(() => {
    if (wasConnectedRef.current && !connected) {
      resetAuthSessionClient();
    }
    wasConnectedRef.current = connected;
  }, [connected]);

  // Смена кошелька: сохранённый verify для другого pubkey недействителен.
  useEffect(() => {
    if (!connected || !pubkey) return;
    purgeStaleVerifiedSession();
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(AUTH_VERIFIED_PUBKEY_KEY);
    } catch {
      stored = null;
    }
    if (stored && stored !== pubkey) {
      clearVerifiedAuthStorage();
      window.dispatchEvent(new CustomEvent('auth:reset'));
    }
  }, [connected, pubkey]);

  // Другая вкладка очистила / обновила storage — переоценить протухший verify.
  useEffect(() => {
    const keys = new Set(readAuthStorageKeysForSync());
    const onStorage = (e: StorageEvent) => {
      if (e.key != null && keys.has(e.key) && purgeStaleVerifiedSession()) {
        window.dispatchEvent(new CustomEvent('auth:reset'));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}
