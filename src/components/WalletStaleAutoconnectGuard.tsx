'use client';

import { useState, type ReactNode } from 'react';
import { WALLET_IDLE_MS, WALLET_LAST_ACTIVITY_KEY } from '@/lib/wallet-autoconnect-policy';

const DEFAULT_WALLET_NAME_KEY = 'walletName';

/**
 * Синхронно до монтирования WalletProvider: если пользователь не был активен на сайте
 * дольше WALLET_IDLE_MS (в т.ч. закрыл вкладку), убираем сохранённый кошелёк — autoconnect не сработает.
 */
export function WalletStaleAutoconnectGuard({ children }: { children: ReactNode }) {
  useState(() => {
    if (typeof window === 'undefined') return true;
    const last = localStorage.getItem(WALLET_LAST_ACTIVITY_KEY);
    if (last) {
      const t = Number(last);
      if (!Number.isNaN(t) && Date.now() - t > WALLET_IDLE_MS) {
        localStorage.removeItem(DEFAULT_WALLET_NAME_KEY);
      }
    }
    return true;
  });
  return <>{children}</>;
}
