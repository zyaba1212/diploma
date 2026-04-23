'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';
import { resetAuthSessionClient } from '@/lib/auth-session';

type ProfileJson = {
  isBanned?: boolean;
};

function shouldSkipPath(pathname: string): boolean {
  return pathname.startsWith('/blocked') || pathname.startsWith('/api/');
}

export function BannedRedirectGuard() {
  const wallet = useWallet();
  const pubkey = useAuthorPubkey();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!wallet.connected || !pubkey || shouldSkipPath(pathname)) return;

    let cancelled = false;
    let inFlight = false;

    const check = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/profile?pubkey=${encodeURIComponent(pubkey)}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ProfileJson;
        if (cancelled) return;
        if (data.isBanned === true) {
          resetAuthSessionClient();
          router.replace(`/blocked?pubkey=${encodeURIComponent(pubkey)}`);
        }
      } catch {
        // Ignore transient network errors; guard will re-check on next route/event.
      } finally {
        inFlight = false;
      }
    };

    void check();

    const onVerified = () => {
      void check();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void check();
    };
    const onPageShow = () => {
      void check();
    };
    const onFocus = () => {
      void check();
    };
    window.addEventListener('auth:verified', onVerified);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('auth:verified', onVerified);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
    };
  }, [wallet.connected, pubkey, pathname, router]);

  return null;
}
