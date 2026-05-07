'use client';
// Страница /networks — UI Next.js App Router.


import { SyntheticEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { useSessionVerified } from '@/hooks/useSessionVerified';
import { Panel } from '@/components/ui/Panel';
import { Button, ButtonLink } from '@/components/ui/Button';
import { usernameIsPinnedNetworkCurator } from '@/lib/pinnedNetworkCurator';
type ProposalDTO = {
  id: string;
  scope: string;
  authorPubkey: string;
  status: string;
  forkedFromProposalId?: string | null;
  title: string | null;
  description: string | null;
  pinned?: boolean;
  createdAt: string;
  votingEndsAt?: string | null;
  _count?: { votes?: number; revisions?: number };
};

type VoteTally = {
  for: number;
  against: number;
  total: number;
  userVote: string | null;
};

export default function NetworksPage() {
  const { publicKey, signMessage } = useWallet();
  const sessionVerified = useSessionVerified();
  const pubkey = publicKey?.toBase58() ?? '';
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tallies, setTallies] = useState<Record<string, VoteTally>>({});
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [myUsername, setMyUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey) {
      setMyUsername(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/profile?pubkey=${encodeURIComponent(pubkey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { username?: string | null } | null) => {
        if (!cancelled && j && typeof j.username === 'string') setMyUsername(j.username);
        else if (!cancelled) setMyUsername(null);
      })
      .catch(() => {
        if (!cancelled) setMyUsername(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/proposals?status=SUBMITTED,ACCEPTED,APPLIED&limit=50')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ProposalDTO[]>;
      })
      .then(async (data) => {
        setProposals(data);
        // Fetch vote tallies
        const tallyMap: Record<string, VoteTally> = {};
        await Promise.all(
          data.map(async (p) => {
            try {
              const r = await fetch(`/api/proposals/${p.id}/vote?voterPubkey=${pubkey}`);
              if (r.ok) tallyMap[p.id] = await r.json();
            } catch {}
          }),
        );
        setTallies(tallyMap);
        // Fetch usernames
        const pubkeys = [...new Set(data.map((p) => p.authorPubkey))];
        if (pubkeys.length > 0) {
          try {
            const r = await fetch('/api/profile/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pubkeys }),
            });
            if (r.ok) {
              const map = (await r.json()) as Record<string, string>;
              setUsernames(map);
            }
          } catch {}
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [pubkey]);

  const handleVote = useCallback(
    async (proposalId: string, voteType: 'FOR' | 'AGAINST') => {
      if (!publicKey || !signMessage || !sessionVerified) return;
      setVoting(true);
      setVoteError(null);
      try {
        const message = `diploma-z96a vote:${proposalId}:${voteType.toLowerCase()}`;
        const msgBytes = new TextEncoder().encode(message);
        const sigBytes = await signMessage(msgBytes);
        const signature = bs58.encode(sigBytes);
        const res = await fetch(`/api/proposals/${proposalId}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voteType, voterPubkey: pubkey, signature }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        // Refresh tally
        const tallyRes = await fetch(`/api/proposals/${proposalId}/vote?voterPubkey=${pubkey}`);
        if (tallyRes.ok) {
          const tally = await tallyRes.json();
          setTallies((prev) => ({ ...prev, [proposalId]: tally }));
        }
      } catch (e: unknown) {
        setVoteError(e instanceof Error ? e.message : 'Ошибка голосования');
      } finally {
        setVoting(false);
      }
    },
    [publicKey, signMessage, pubkey, sessionVerified],
  );

  const handleSelect = useCallback(
    (id: string) => {
      if (selectedId === id) {
        setSelectedId(null);
      } else {
        setSelectedId(id);
      }
    },
    [selectedId],
  );

  const handleWithdraw = useCallback(
    async (proposalId: string) => {
      if (!publicKey || !signMessage || !sessionVerified) return;
      if (
        !window.confirm(
          'Снять предложение с голосования? Оно исчезнет из списка активных предложений. Безвозвратное удаление из базы — только в личном кабинете.',
        )
      ) {
        return;
      }
      setWithdrawingId(proposalId);
      setWithdrawError(null);
      try {
        const message = `diploma-z96a propose:withdraw:${proposalId}`;
        const sigBytes = await signMessage(new TextEncoder().encode(message));
        const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/withdraw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authorPubkey: pubkey, signature: bs58.encode(sigBytes) }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
          };
          let msg = data.error || `HTTP ${res.status}`;
          if (data.code === 'SCHEMA_ENUM_MISSING') {
            msg =
              'На сервере не применены миграции БД (статус WITHDRAWN). Обратитесь к администратору или выполните prisma migrate deploy.';
          }
          throw new Error(msg);
        }
        setProposals((prev) => prev.filter((p) => p.id !== proposalId));
        setSelectedId(null);
        setTallies((prev) => {
          const next = { ...prev };
          delete next[proposalId];
          return next;
        });
      } catch (e: unknown) {
        setWithdrawError(e instanceof Error ? e.message : 'Ошибка снятия с голосования');
      } finally {
        setWithdrawingId(null);
      }
    },
    [publicKey, signMessage, pubkey, sessionVerified],
  );

  const stopCardSelectionFromAction = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const timeRemaining = (endsAt: string | null | undefined) => {
    if (!endsAt) return null;
    const diff = new Date(endsAt).getTime() - Date.now();
    if (diff <= 0) return 'Голосование завершено';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}ч ${minutes}м осталось`;
  };

  return (
    <div
      className="networks-page"
      style={{ minHeight: '100vh', background: 'var(--bg)', padding: '72px 24px 40px' }}
    >
      <div className="networks-page-inner" style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 24 }}>
          ПРЕДЛОЖЕННАЯ СЕТЬ
        </h1>

        {loading && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}
        {error && <p style={{ color: 'var(--danger, #ff6b6b)' }}>Ошибка: {error}</p>}
        {voteError && <p style={{ color: 'var(--danger, #ff6b6b)', fontSize: 13 }}>Голосование: {voteError}</p>}
        {withdrawError && <p style={{ color: 'var(--danger, #ff6b6b)', fontSize: 13 }}>Снятие с голосования: {withdrawError}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {proposals.map((p) => {
            const tally = tallies[p.id];
            const isSelected = selectedId === p.id;
            const remaining = timeRemaining(p.votingEndsAt);
            const isAuthor = Boolean(pubkey && p.authorPubkey === pubkey);
            const viewerIsPinnedCurator = usernameIsPinnedNetworkCurator(myUsername);
            const canOpenSandboxEditor =
              Boolean(publicKey && sessionVerified) &&
              (p.status === 'SUBMITTED' || p.status === 'ACCEPTED' || p.status === 'APPLIED') &&
              (isAuthor || (p.pinned && viewerIsPinnedCurator));

            return (
              <div
                key={p.id}
                className="networks-proposal-card"
                role="button"
                tabIndex={0}
                style={{
                  background: isSelected ? 'rgba(120,160,255,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? 'rgba(120,160,255,0.3)' : 'rgba(232,236,255,0.10)'}`,
                  borderRadius: 4,
                  padding: '18px 22px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => handleSelect(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(p.id);
                  }
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {p.title || 'Без названия'}
                      {p.pinned ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: '#a78bfa',
                            border: '1px solid rgba(167, 139, 250, 0.45)',
                            borderRadius: 6,
                            padding: '2px 8px',
                          }}
                        >
                          Закреплено
                        </span>
                      ) : null}
                    </h2>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      {usernames[p.authorPubkey] || p.authorPubkey.slice(0, 8) + '…'}
                      {' · '}
                      {new Date(p.createdAt).toLocaleDateString('ru-RU')}
                      {' · '}
                      <span style={{ color: p.status === 'SUBMITTED' ? '#8ab4f8' : p.status === 'ACCEPTED' ? '#3ddc97' : '#f6c177' }}>
                        {p.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>Ревизий: {p._count?.revisions ?? 0}</span>
                      {p.forkedFromProposalId ? (
                        <span>
                          fork от: <code style={{ fontSize: 10 }}>{p.forkedFromProposalId.slice(0, 8)}…</code>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {remaining && (
                    <span style={{ fontSize: 11, color: '#f6c177', whiteSpace: 'nowrap' }}>{remaining}</span>
                  )}
                </div>

                {/* Vote bar */}
                {tally && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: '#3ddc97' }}>За: {tally.for}</span>
                      <span style={{ color: '#ff6b6b' }}>Против: {tally.against}</span>
                      <span style={{ color: 'var(--muted)' }}>Всего: {tally.total}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      {tally.total > 0 && (
                        <div
                          style={{
                            height: '100%',
                            width: `${(tally.for / tally.total) * 100}%`,
                            background: '#3ddc97',
                            borderRadius: 2,
                            transition: 'width 0.3s',
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* View and voting buttons */}
                {isSelected && (
                  <div
                    className="networks-vote-actions"
                    style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                    onClick={stopCardSelectionFromAction}
                    onPointerDown={stopCardSelectionFromAction}
                    onTouchStart={stopCardSelectionFromAction}
                    onMouseDown={stopCardSelectionFromAction}
                  >
                    <>
                      <ButtonLink href={`/networks/${p.id}`}>Просмотр сети</ButtonLink>
                      {canOpenSandboxEditor ? (
                        <ButtonLink href={`/sandbox?proposalId=${encodeURIComponent(p.id)}`}>
                          Редактировать
                        </ButtonLink>
                      ) : null}
                      {p.status === 'SUBMITTED' && publicKey && (
                        <>
                          <Button
                            onClick={() => handleVote(p.id, 'FOR')}
                            disabled={voting || tally?.userVote != null || !sessionVerified}
                          >
                            {tally?.userVote === 'FOR' ? '✓ За' : 'За'}
                          </Button>
                          <Button
                            onClick={() => handleVote(p.id, 'AGAINST')}
                            disabled={voting || tally?.userVote != null || !sessionVerified}
                          >
                            {tally?.userVote === 'AGAINST' ? '✓ Против' : 'Против'}
                          </Button>
                        </>
                      )}
                      {p.status === 'SUBMITTED' && isAuthor && sessionVerified && signMessage && (
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => void handleWithdraw(p.id)}
                          disabled={withdrawingId === p.id}
                        >
                          {withdrawingId === p.id ? 'Снятие…' : 'Снять с голосования'}
                        </Button>
                      )}
                    </>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!loading && proposals.length === 0 && !error && (
          <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--muted)' }}>
            <p style={{ fontSize: 16, marginBottom: 12 }}>Пока нет предложений на голосовании</p>
            <Link href="/sandbox" style={{ color: '#8ab4f8', textDecoration: 'none' }}>
              Создайте свою сеть в Песочнице →
            </Link>
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 768px) {
          .networks-page {
            padding: 72px 10px 40px !important;
          }
          .networks-page-inner {
            max-width: min(800px, 100%) !important;
            width: 100%;
            box-sizing: border-box;
          }
          .networks-proposal-card {
            padding: 14px 10px !important;
            min-width: 0;
          }
          .networks-card-chips {
            flex-wrap: nowrap !important;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            padding-bottom: 4px;
            max-width: 100%;
          }
          .networks-card-chips > span {
            flex-shrink: 0;
          }
        }
        @media (max-width: 399px) {
          .networks-vote-actions {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .networks-vote-actions > a {
            width: 100%;
            display: block;
            box-sizing: border-box;
          }
          .networks-vote-actions > a button {
            width: 100%;
            box-sizing: border-box;
          }
          .networks-vote-actions > button {
            width: 100%;
            box-sizing: border-box;
          }
        }
      `}</style>
    </div>
  );
}
