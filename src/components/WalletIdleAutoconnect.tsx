'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useEffect, useRef } from 'react';
import {
  ACTIVITY_PERSIST_THROTTLE_MS,
  WALLET_IDLE_MS,
  WALLET_LAST_ACTIVITY_KEY,
} from '@/lib/wallet-autoconnect-policy';

/**
 * Обновляет метку last-activity и по истечении WALLET_IDLE_MS без событий отключает кошелёк
 * (что сбрасывает сохранённый walletName в @solana/wallet-adapter-react — как при «Отключить»).
 */
export function WalletIdleAutoconnect() {
  const { connected, disconnect } = useWallet();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistRef = useRef(0);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current != null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const persistActivityNow = useCallback(() => {
    const now = Date.now();
    try {
      localStorage.setItem(WALLET_LAST_ACTIVITY_KEY, String(now));
    } catch {
      /* ignore quota / private mode */
    }
    lastPersistRef.current = now;
  }, []);

  const scheduleIdle = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      void (async () => {
        try {
          await disconnect();
        } catch {
          /* disconnect errors are non-fatal */
        }
      })();
    }, WALLET_IDLE_MS);
  }, [clearIdleTimer, disconnect]);

  const onActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastPersistRef.current >= ACTIVITY_PERSIST_THROTTLE_MS) {
      persistActivityNow();
    }
    // Avoid calling `disconnect()` while we're not connected.
    // We still persist activity timestamp so the stale autoconnect guard works correctly.
    if (connected) scheduleIdle();
  }, [connected, persistActivityNow, scheduleIdle]);

  useEffect(() => {
    persistActivityNow();

    const opts: AddEventListenerOptions = { passive: true };
    const windowEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    const handler = () => {
      if (document.visibilityState === 'hidden') return;
      onActivity();
    };
    windowEvents.forEach((ev) => window.addEventListener(ev, handler, opts));
    document.addEventListener('visibilitychange', handler, opts);

    return () => {
      clearIdleTimer();
      windowEvents.forEach((ev) => window.removeEventListener(ev, handler, opts));
      document.removeEventListener('visibilitychange', handler, opts);
    };
  }, [clearIdleTimer, onActivity, persistActivityNow, scheduleIdle]);

  useEffect(() => {
    if (!connected) {
      clearIdleTimer();
      return;
    }
    persistActivityNow();
    scheduleIdle();
  }, [connected, clearIdleTimer, persistActivityNow, scheduleIdle]);

  return null;
}
