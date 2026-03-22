'use client';

import bs58 from 'bs58';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';
import { buildUsernameMessage, normalizeUsername, validateUsernameFormat } from '@/lib/username';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';

type ProfileJson = {
  pubkey: string;
  username: string | null;
  usernameSetAt: string | null;
  inDatabase?: boolean;
};

type ProposalListItem = {
  id: string;
  status: string;
  title: string | null;
  createdAt: string;
};

type ProposalDetail = {
  id: string;
  actions?: unknown[];
};

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT: { label: 'Черновик', bg: 'rgba(160,160,170,0.2)', color: '#c8cad0' },
  SUBMITTED: { label: 'На голосовании', bg: 'rgba(80,140,255,0.2)', color: '#8ab4f8' },
  ACCEPTED: { label: 'Принято', bg: 'rgba(80,200,120,0.2)', color: '#8fdf9a' },
  REJECTED: { label: 'Отклонено', bg: 'rgba(255,100,100,0.18)', color: '#ff9a9a' },
  APPLIED: { label: 'Применено', bg: 'rgba(200,160,255,0.15)', color: '#d4b8ff' },
};

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? { label: status, bg: 'rgba(160,160,170,0.15)', color: 'var(--muted)' };
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

export default function CabinetPage() {
  const wallet = useWallet();
  const pubkey = useAuthorPubkey();
  const [profile, setProfile] = useState<ProfileJson | null>(null);
  const [nick, setNick] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const canEditUsername = wallet.connected && !!wallet.signMessage;

  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [actionCounts, setActionCounts] = useState<Record<string, number>>({});
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!pubkey) { setProfile(null); return; }
    const res = await fetch(`/api/profile?pubkey=${encodeURIComponent(pubkey)}`);
    if (!res.ok) { setStatus('не удалось загрузить профиль'); return; }
    setProfile((await res.json()) as ProfileJson);
  }, [pubkey]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  useEffect(() => {
    const handler = () => { void loadProfile(); };
    window.addEventListener('auth:verified', handler);
    return () => window.removeEventListener('auth:verified', handler);
  }, [loadProfile]);

  const loadProposals = useCallback(async () => {
    if (!pubkey) { setProposals([]); setActionCounts({}); return; }
    setProposalsLoading(true);
    setProposalsError(null);
    try {
      const res = await fetch(`/api/proposals?authorPubkey=${encodeURIComponent(pubkey)}&limit=50`);
      if (!res.ok) { setProposalsError(`HTTP ${res.status}`); setProposals([]); return; }
      const list = (await res.json()) as ProposalListItem[];
      setProposals(Array.isArray(list) ? list : []);

      const counts: Record<string, number> = {};
      await Promise.all(
        (Array.isArray(list) ? list : []).map(async (p) => {
          try {
            const r = await fetch(`/api/proposals/${encodeURIComponent(p.id)}`);
            if (!r.ok) return;
            const detail = (await r.json()) as ProposalDetail;
            counts[p.id] = Array.isArray(detail.actions) ? detail.actions.length : 0;
          } catch { counts[p.id] = 0; }
        }),
      );
      setActionCounts(counts);
    } catch (e: unknown) {
      setProposalsError(e instanceof Error ? e.message : 'ошибка загрузки');
      setProposals([]);
    } finally {
      setProposalsLoading(false);
    }
  }, [pubkey]);

  useEffect(() => { void loadProposals(); }, [loadProposals]);

  useEffect(() => {
    const handler = () => { void loadProposals(); };
    window.addEventListener('auth:verified', handler);
    return () => window.removeEventListener('auth:verified', handler);
  }, [loadProposals]);

  const setUsername = useCallback(async () => {
    if (!pubkey || !wallet.connected || !wallet.signMessage) {
      setStatus('нужен подключённый кошелёк с подписью');
      return;
    }
    const u = normalizeUsername(nick);
    const v = validateUsernameFormat(u);
    if (!v.ok) { setStatus(v.error); return; }
    setBusy(true);
    setStatus('');
    try {
      const ts = new Date().toISOString();
      const message = buildUsernameMessage(pubkey, u, ts);
      const encoded = new TextEncoder().encode(message);
      const signature = await wallet.signMessage(encoded);
      const res = await fetch('/api/profile/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: pubkey, message, signature: bs58.encode(signature), username: u }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) { setStatus(json.error || `HTTP ${res.status}`); return; }
      setStatus('ник сохранён');
      setNick('');
      await loadProfile();
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'ошибка');
    } finally { setBusy(false); }
  }, [nick, pubkey, wallet, loadProfile]);

  return (
    <div
      className="cabinet-page"
      style={{ minHeight: '100vh', padding: 16, paddingTop: 70, background: 'var(--bg, #0a0a12)', color: 'var(--text, #eee)' }}
    >
      <div className="cabinet-page-inner" style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Panel title="Профиль">
          {!pubkey ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Подключите кошелёк.</p>
          ) : (
            <>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                <div style={{ marginTop: 6 }}>
                  <span style={{ color: 'var(--muted)' }}>username:</span>{' '}
                  {profile?.username ?? '—'}
                </div>
                {profile?.inDatabase === false && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                    Записи в БД ещё нет — нажмите &laquo;Авторизовать&raquo; в блоке кошелька или сохраните ник ниже.
                  </p>
                )}
              </div>
              {profile ? (
                canEditUsername ? (
                  <div className="cabinet-username-form" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
                    <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Username (3-32: латиница, цифры, _)
                      <input value={nick} onChange={(e) => setNick(e.target.value)} disabled={busy}
                        style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.06)', color: 'var(--text)' }}
                      />
                    </label>
                    <Button type="button" onClick={() => void setUsername()} disabled={busy}>
                      Подписать и сохранить ник
                    </Button>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>Нужен подключённый кошелёк с подписью</p>
                )
              ) : (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>Загрузка профиля...</p>
              )}
            </>
          )}
          {status && (
            <p style={{ fontSize: 12, marginTop: 8, color: status.includes('сохран') ? '#8f8' : 'var(--muted)' }}>
              {status}
            </p>
          )}
        </Panel>

        <Panel title="Мои предложения">
          {!pubkey ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Подключите кошелёк</p>
          ) : proposalsLoading ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Загрузка...</p>
          ) : proposalsError ? (
            <p style={{ fontSize: 13, color: '#f88' }}>{proposalsError}</p>
          ) : proposals.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Пока нет предложений.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {proposals.map((p) => {
                const badge = statusBadge(p.status);
                const count = actionCounts[p.id] ?? 0;
                return (
                  <Link key={p.id} href={`/networks/${p.id}`}
                    className="cabinet-proposal-card"
                    style={{ display: 'block', border: '1px solid var(--border)', borderRadius: 10, padding: 10, textDecoration: 'none', color: 'inherit', background: 'rgba(255,255,255,0.03)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>
                        {p.title?.trim() || 'Без названия'}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 8, flexShrink: 0, background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                      {formatDate(p.createdAt)} &middot; элементов: {count}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <Link href="/sandbox" style={{ fontSize: 13, fontWeight: 600, color: '#8ab4f8', textDecoration: 'none' }}>
              Создать новое &rarr;
            </Link>
          </div>
        </Panel>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .cabinet-page {
            padding: 10px !important;
            padding-top: 64px !important;
          }
          .cabinet-page-inner {
            max-width: 100% !important;
            width: 100%;
            box-sizing: border-box;
          }
          .cabinet-username-form {
            max-width: 100% !important;
          }
          .cabinet-username-form input {
            width: 100% !important;
            box-sizing: border-box;
          }
          .cabinet-username-form button {
            width: 100%;
            box-sizing: border-box;
          }
          .cabinet-auth-wrap > div {
            max-width: 100% !important;
          }
          .cabinet-auth-wrap > div > div:last-child {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .cabinet-auth-wrap button {
            width: 100%;
            box-sizing: border-box;
          }
          .cabinet-proposal-card {
            padding: 8px 8px !important;
          }
          .cabinet-proposal-card > div:first-child > div:first-child {
            font-size: 13px !important;
          }
          .cabinet-proposal-card > div:first-child > span {
            font-size: 9px !important;
            padding: 2px 6px !important;
          }
          .cabinet-proposal-card > div:last-child {
            font-size: 11px !important;
            margin-top: 4px !important;
          }
        }
      `}</style>
    </div>
  );
}
