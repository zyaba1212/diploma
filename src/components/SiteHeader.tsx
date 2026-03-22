'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';

const NAV_LINK_STYLE: React.CSSProperties = {
  pointerEvents: 'auto',
  textDecoration: 'none',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 10,
};

const LINKS: { href: string; label: string }[] = [
  { href: '/', label: 'Главная' },
  { href: '/about', label: 'О нас' },
  { href: '/global-network', label: 'Глобальная сеть' },
  { href: '/sandbox', label: 'Песочница' },
  { href: '/networks', label: 'Предложения' },
  { href: '/news', label: 'Новости' },
];

function truncatePubkey(pk: string): string {
  if (pk.length <= 8) return pk;
  return `${pk.slice(0, 4)}...${pk.slice(-4)}`;
}

type ProfileJson = {
  username: string | null;
  inDatabase?: boolean;
};

const btnBase: React.CSSProperties = {
  appearance: 'none',
  borderRadius: 10,
  border: '1px solid rgba(232, 236, 255, 0.18)',
  background: 'rgba(255,255,255,0.08)',
  color: 'var(--text)',
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

export function SiteHeader() {
  const pathname = usePathname();
  const wallet = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const pubkey = useAuthorPubkey();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileJson | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [connBusy, setConnBusy] = useState(false);

  const walletWrapRef = useRef<HTMLDivElement>(null);
  const mobileMenuWrapRef = useRef<HTMLDivElement>(null);

  const authorized = profile?.inDatabase === true;

  const loadProfile = useCallback(async () => {
    if (!pubkey) { setProfile(null); return; }
    setProfileLoading(true);
    try {
      const res = await fetch(`/api/profile?pubkey=${encodeURIComponent(pubkey)}`);
      if (res.ok) setProfile((await res.json()) as ProfileJson);
      else setProfile(null);
    } catch { setProfile(null); }
    finally { setProfileLoading(false); }
  }, [pubkey]);

  useEffect(() => {
    if (!wallet.connected || !pubkey) { setProfile(null); return; }
    void loadProfile();
  }, [wallet.connected, pubkey, loadProfile]);

  useEffect(() => {
    const onVerified = () => { void loadProfile(); };
    window.addEventListener('auth:verified', onVerified);
    return () => window.removeEventListener('auth:verified', onVerified);
  }, [loadProfile]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (walletWrapRef.current && !walletWrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onDown = (e: MouseEvent) => {
      if (mobileMenuWrapRef.current && !mobileMenuWrapRef.current.contains(e.target as Node)) {
        setMobileNavOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mobileNavOpen]);

  useEffect(() => {
    const onResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth >= 768) setMobileNavOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const authorize = useCallback(async () => {
    if (!wallet.connected || !wallet.signMessage || !pubkey) return;
    setAuthBusy(true);
    try {
      const message = `diploma-z96a auth\npubkey=${pubkey}\nts=${new Date().toISOString()}`;
      const encoded = new TextEncoder().encode(message);
      const signature = await wallet.signMessage(encoded);
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: pubkey, message, signature: bs58.encode(signature) }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await loadProfile();
      window.dispatchEvent(new CustomEvent('auth:verified', { detail: { pubkey } }));
      setDropdownOpen(false);
    } catch { /* wallet popup cancelled or network error */ }
    finally { setAuthBusy(false); }
  }, [pubkey, wallet, loadProfile]);

  const handleDisconnect = useCallback(async () => {
    if (!wallet.connected || !wallet.disconnect) return;
    setConnBusy(true);
    try {
      await wallet.disconnect();
      setProfile(null);
      setDropdownOpen(false);
    } catch { /* ignore */ }
    finally { setConnBusy(false); }
  }, [wallet]);

  const displayLabel = authorized && profile?.username
    ? profile.username
    : pubkey ? truncatePubkey(pubkey) : '';

  const mobileNavLinkStyle: React.CSSProperties = {
    ...NAV_LINK_STYLE,
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    borderRadius: 0,
  };

  return (
    <header
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        height: 52,
        zIndex: 1000,
        pointerEvents: 'none',
        background: 'rgba(11,16,32,0.35)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(232, 236, 255, 0.10)',
      }}
      aria-label="Site header"
    >
      <div style={{ position: 'relative', height: '100%', width: '100%' }}>
        <style
          dangerouslySetInnerHTML={{
            __html: `
@media (max-width: 767px) {
  .site-header-nav { display: none !important; }
  .site-header-hamburger {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
  }
  .site-header-mobile-panel { display: flex !important; }
  .site-header-wallet-area { gap: 4px !important; }
  .site-header-wallet-area .site-header-wallet-label { font-size: 11px !important; }
  .site-header-wallet-area .site-header-wallet-badge { font-size: 10px !important; }
  .site-header-wallet-area .site-header-wallet-btn { padding: 4px 6px !important; font-size: 10px !important; min-width: 26px !important; }
  .site-header-wallet-area .site-header-connect-btn { padding: 5px 8px !important; font-size: 11px !important; }
}
@media (min-width: 768px) {
  .site-header-hamburger { display: none !important; }
  .site-header-mobile-panel { display: none !important; }
}
`,
          }}
        />

        <div
          ref={mobileMenuWrapRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <div
            style={{
              height: 52,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 10,
              pointerEvents: 'none',
            }}
          >
            <button
              type="button"
              className="site-header-hamburger"
              style={{
                ...btnBase,
                minWidth: 44,
                minHeight: 44,
                padding: 0,
                fontSize: 20,
                lineHeight: 1,
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
              }}
              aria-label={mobileNavOpen ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((v) => !v)}
            >
              ☰
            </button>
          </div>

          {mobileNavOpen && (
            <div
              className="site-header-mobile-panel"
              style={{
                pointerEvents: 'auto',
                position: 'absolute',
                top: 52,
                left: 0,
                right: 0,
                flexDirection: 'column',
                background: 'rgba(18, 22, 40, 0.98)',
                borderBottom: '1px solid rgba(232, 236, 255, 0.14)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                zIndex: 1001,
              }}
            >
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileNavOpen(false)}
                  style={{
                    ...mobileNavLinkStyle,
                    ...(pathname === link.href ? { background: 'rgba(120,160,255,0.15)', color: '#8ab4f8' } : {}),
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div
          className="site-header-nav"
          style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                ...NAV_LINK_STYLE,
                ...(pathname === link.href ? { background: 'rgba(120,160,255,0.15)', color: '#8ab4f8' } : {}),
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div
          ref={walletWrapRef}
          className="site-header-wallet-area"
          style={{
            position: 'absolute',
            right: 10, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center', gap: 6,
            pointerEvents: 'auto', zIndex: 2,
          }}
        >
          {!wallet.connected ? (
            <button
              type="button"
              className="site-header-connect-btn"
              style={btnBase}
              onClick={() => openWalletModal(true)}
              disabled={wallet.connecting || connBusy}
            >
              Подключить
            </button>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                <span className="site-header-wallet-label" style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                  {profileLoading ? '...' : displayLabel}
                </span>
                {authorized ? (
                  <span className="site-header-wallet-badge" style={{ fontSize: 11, color: 'var(--muted)' }}>авторизован</span>
                ) : (
                  <button
                    type="button"
                    className="site-header-wallet-btn"
                    style={{ ...btnBase, padding: '5px 8px', fontSize: 11 }}
                    onClick={() => void authorize()}
                    disabled={authBusy || !wallet.signMessage}
                  >
                    Авторизовать
                  </button>
                )}
                <button
                  type="button"
                  className="site-header-wallet-btn"
                  style={{ ...btnBase, padding: '5px 8px', minWidth: 28 }}
                  onClick={() => setDropdownOpen((v) => !v)}
                  aria-expanded={dropdownOpen}
                >
                  &#x25BE;
                </button>
              </div>

              {dropdownOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute', top: 'calc(100% + 4px)', right: 0,
                    minWidth: 200, padding: 8, borderRadius: 10,
                    border: '1px solid rgba(232, 236, 255, 0.14)',
                    background: 'rgba(18, 22, 40, 0.98)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <Link href="/cabinet" onClick={() => setDropdownOpen(false)} style={{ fontSize: 13, fontWeight: 600, color: '#8ab4f8', textDecoration: 'none', padding: '6px 8px', borderRadius: 8 }}>
                    Личный кабинет
                  </Link>
                  <button
                    type="button"
                    style={{ ...btnBase, width: '100%', textAlign: 'left', borderColor: 'rgba(255,107,107,0.35)', background: 'rgba(255,107,107,0.12)' }}
                    onClick={() => void handleDisconnect()}
                    disabled={connBusy || wallet.disconnecting || authBusy}
                  >
                    Отключить
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
