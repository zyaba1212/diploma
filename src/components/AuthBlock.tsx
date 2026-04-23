'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useCallback, useEffect, useState } from 'react';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';
import { useSessionVerified } from '@/hooks/useSessionVerified';
import { resetAuthSessionClient, signAndVerifyAuthSession } from '@/lib/auth-session';
import { Button } from './ui/Button';

type ProfileJson = {
  username: string | null;
  usernameSetAt: string | null;
  inDatabase?: boolean;
  isBanned?: boolean;
};

export function AuthBlock() {
  const wallet = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const pubkey = useAuthorPubkey();
  const sessionVerified = useSessionVerified();
  const [status, setStatus] = useState<string>('не авторизован');
  const [busy, setBusy] = useState(false);
  const [connBusy, setConnBusy] = useState(false);
  const [profile, setProfile] = useState<ProfileJson | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (!wallet.connected) {
      setStatus('не авторизован');
      setProfile(null);
    }
  }, [wallet.connected]);

  const loadProfile = useCallback(async () => {
    if (!pubkey) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    try {
      const res = await fetch(`/api/profile?pubkey=${encodeURIComponent(pubkey)}`, { cache: 'no-store' });
      if (!res.ok) {
        setProfile(null);
        return;
      }
      const json = (await res.json()) as ProfileJson;
      if (json.isBanned) {
        resetAuthSessionClient();
      }
      setProfile(json);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, [pubkey]);

  useEffect(() => {
    if (!wallet.connected || !pubkey) {
      setProfile(null);
      return;
    }
    void loadProfile();
  }, [wallet.connected, pubkey, loadProfile]);

  const safeErrorMessage = useCallback((e: unknown) => {
    if (e instanceof Error) return e.message;
    return 'unknown error';
  }, []);

  const authorize = useCallback(async () => {
    if (!wallet.connected) {
      setStatus('сначала подключите кошелёк');
      return;
    }
    if (!wallet.signMessage) {
      setStatus('кошелёк не поддерживает подпись');
      return;
    }
    if (!pubkey) {
      setStatus('нет pubkey');
      return;
    }

    setBusy(true);
    try {
      const result = await signAndVerifyAuthSession(pubkey, wallet.signMessage);
      if (result === 'banned') {
        setStatus('Аккаунт заблокирован администратором.');
        return;
      }
      if (result !== 'ok') throw new Error('подпись отклонена или ошибка сети');
      await loadProfile();
    } catch (e: unknown) {
      setStatus(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [pubkey, safeErrorMessage, wallet, loadProfile]);

  const handleConnect = useCallback(async () => {
    if (wallet.connected || wallet.connecting || wallet.disconnecting || connBusy) return;
    if (!wallet.connect) {
      setStatus('connect не поддерживается');
      return;
    }

    setConnBusy(true);
    setStatus('подключение…');
    try {
      if (!wallet.wallet) {
        openWalletModal(true);
        setStatus('выберите кошелёк');
        return;
      }
      await wallet.connect();
      setStatus('не авторизован');
    } catch (e: unknown) {
      setStatus(safeErrorMessage(e));
      try {
        openWalletModal(true);
      } catch {
        /* non-fatal */
      }
    } finally {
      setConnBusy(false);
    }
  }, [connBusy, openWalletModal, safeErrorMessage, wallet]);

  const handleDisconnect = useCallback(async () => {
    if (!wallet.connected || wallet.disconnecting || !wallet.disconnect) return;
    setBusy(true);
    try {
      setStatus('отключение…');
      resetAuthSessionClient();
      await wallet.disconnect();
      setStatus('не авторизован');
      setProfile(null);
    } catch (e: unknown) {
      setStatus(safeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [safeErrorMessage, wallet]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        maxWidth: 280,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>
        {wallet.connected ? (
          <>
            {profileLoading ? (
              <span>загрузка профиля…</span>
            ) : (
              <span>username: {profile?.username ?? '—'}</span>
            )}
            <span style={{ marginLeft: 6, opacity: 0.85 }}>
              {profile?.isBanned
                ? 'заблокирован'
                : sessionVerified && profile?.inDatabase
                  ? 'авторизован'
                  : status}
            </span>
          </>
        ) : wallet.connecting ? (
          'подключение…'
        ) : (
          'не подключено'
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {!wallet.connected ? (
          <Button
            type="button"
            onClick={() => void handleConnect()}
            disabled={busy || connBusy || wallet.connecting}
          >
            Подключить кошелёк
          </Button>
        ) : (
          <>
            <Button
              type="button"
              onClick={() => void authorize()}
              disabled={
                busy ||
                profile?.isBanned === true ||
                (sessionVerified && profile?.inDatabase === true)
              }
            >
              Авторизоваться
            </Button>
            <Button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={busy || wallet.disconnecting || connBusy}
              variant="danger"
            >
              Отключить
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
