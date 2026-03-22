'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useMemo } from 'react';

/**
 * Returns the current wallet public key (Phantom) as a base58 string, or null if unavailable.
 * This is the canonical source for `authorPubkey` on the frontend (e.g. for `/api/proposals`).
 */
export function useAuthorPubkey(): string | null {
  const { publicKey } = useWallet();

  return useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
}

