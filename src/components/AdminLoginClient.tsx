'use client';

import bs58 from 'bs58';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';

function buildAdminWalletMessage(nonce: string): string {
  return `diploma-z96a admin-login\nnonce=${nonce}`;
}

export function AdminLoginClient() {
  const router = useRouter();
  const wallet = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const pubkey = useAuthorPubkey();

  const [walBusy, setWalBusy] = useState(false);
  const [walErr, setWalErr] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const onWalletLogin = useCallback(async () => {
    setWalErr(null);
    if (!wallet.connected || !wallet.signMessage || !pubkey) {
      setWalErr('подключите кошелёк');
      return;
    }
    setWalBusy(true);
    try {
      const nRes = await fetch('/api/admin/auth/nonce', { credentials: 'same-origin' });
      const nJson = (await nRes.json().catch(() => null)) as { nonce?: string; error?: string } | null;
      if (!nRes.ok || !nJson?.nonce) {
        setWalErr(nJson?.error || `nonce ${nRes.status}`);
        return;
      }
      const nonce = nJson.nonce;
      const message = buildAdminWalletMessage(nonce);
      const encoded = new TextEncoder().encode(message);
      const signature = await wallet.signMessage(encoded);
      const res = await fetch('/api/admin/login/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ publicKey: pubkey, message, signature: bs58.encode(signature), nonce }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 403 && j?.error === 'banned') {
          router.replace(`/blocked?pubkey=${encodeURIComponent(pubkey)}`);
          return;
        }
        setWalErr(j?.error || `HTTP ${res.status}`);
        return;
      }
      router.replace('/admin');
      router.refresh();
    } catch {
      setWalErr('подпись отменена или ошибка сети');
    } finally {
      setWalBusy(false);
    }
  }, [pubkey, wallet, router]);

  return (
    <div style={{ minHeight: '100vh', padding: 16, maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 16px', textAlign: 'center' }}>Админ-панель</h1>

      <Panel title="Phantom">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 10,
            marginTop: 4,
          }}
        >
          {!mounted ? (
            <Button type="button" onClick={() => openWalletModal(true)} disabled>
              Выбрать кошелёк
            </Button>
          ) : !wallet.wallet ? (
            <Button type="button" onClick={() => openWalletModal(true)}>
              Выбрать кошелёк
            </Button>
          ) : !wallet.connected ? (
            <Button type="button" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              Подключить
            </Button>
          ) : (
            <Button type="button" onClick={onWalletLogin} disabled={walBusy || !wallet.signMessage}>
              {walBusy ? 'Подпись…' : 'Войти'}
            </Button>
          )}
        </div>
        {walErr ? <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{walErr}</p> : null}
      </Panel>
    </div>
  );
}
