'use client';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { useMemo } from 'react';
import { WalletIdleAutoconnect } from '@/components/WalletIdleAutoconnect';
import { WalletStaleAutoconnectGuard } from '@/components/WalletStaleAutoconnectGuard';

export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const SafeConnectionProvider = ConnectionProvider as unknown as React.ComponentType<any>;
  const SafeWalletProvider = WalletProvider as unknown as React.ComponentType<any>;
  const SafeWalletModalProvider = WalletModalProvider as unknown as React.ComponentType<{
    children: React.ReactNode;
  }>;

  return (
    <SafeConnectionProvider endpoint={endpoint}>
      <WalletStaleAutoconnectGuard>
        <SafeWalletProvider wallets={wallets} autoConnect>
          <WalletIdleAutoconnect />
          <SafeWalletModalProvider>{children}</SafeWalletModalProvider>
        </SafeWalletProvider>
      </WalletStaleAutoconnectGuard>
    </SafeConnectionProvider>
  );
}

