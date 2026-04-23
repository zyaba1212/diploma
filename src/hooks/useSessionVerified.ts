'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useEffect, useState } from 'react';
import {
  AUTH_BROADCAST_CHANNEL_NAME,
  AUTH_LAST_ANY_TAB_ALIVE_KEY,
  AUTH_VERIFIED_PUBKEY_KEY,
  isAuthSessionVerifiedForPubkey,
} from '@/lib/auth-session';

/**
 * true, если кошелёк подключён и для текущего pubkey есть непротухший клиентский сеанс verify.
 */
export function useSessionVerified(): boolean {
  const { connected, publicKey } = useWallet();
  const pubkey = publicKey?.toBase58() ?? null;

  const [verified, setVerified] = useState(false);

  const refresh = useCallback(() => {
    if (!connected || !pubkey) {
      setVerified(false);
      return;
    }
    setVerified(isAuthSessionVerifiedForPubkey(pubkey));
  }, [connected, pubkey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onVerified = () => {
      refresh();
    };
    const onReset = () => {
      setVerified(false);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_VERIFIED_PUBKEY_KEY || e.key === AUTH_LAST_ANY_TAB_ALIVE_KEY) {
        refresh();
      }
    };

    window.addEventListener('auth:verified', onVerified);
    window.addEventListener('auth:reset', onReset);
    window.addEventListener('storage', onStorage);

    let ch: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        ch = new BroadcastChannel(AUTH_BROADCAST_CHANNEL_NAME);
        ch.onmessage = (ev: MessageEvent<{ type?: string }>) => {
          const t = ev.data?.type;
          if (t === 'auth:reset') setVerified(false);
          if (t === 'auth:verified') refresh();
        };
      } catch {
        ch = null;
      }
    }

    return () => {
      window.removeEventListener('auth:verified', onVerified);
      window.removeEventListener('auth:reset', onReset);
      window.removeEventListener('storage', onStorage);
      ch?.close();
    };
  }, [refresh]);

  return verified;
}
