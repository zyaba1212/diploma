'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';

type ProposalDTO = {
  id: string;
  scope: string;
  authorPubkey: string;
  status: string;
  title: string | null;
  description: string | null;
  createdAt: string;
  votingEndsAt?: string | null;
};

type VoteTally = {
  for: number;
  against: number;
  total: number;
  userVote: string | null;
};

type ActionDTO = {
  actionType: string;
  elementPayload: Record<string, unknown>;
};

export default function NetworksPage() {
  const { publicKey, signMessage } = useWallet();
  const pubkey = publicKey?.toBase58() ?? '';

  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tallies, setTallies] = useState<Record<string, VoteTally>>({});
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedActions, setSelectedActions] = useState<ActionDTO[]>([]);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

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
      if (!publicKey || !signMessage) return;
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
    [publicKey, signMessage, pubkey],
  );

  const loadActions = useCallback(async (proposalId: string) => {
    try {
      const r = await fetch(`/api/proposals/${proposalId}`);
      if (!r.ok) return;
      const data = await r.json();
      setSelectedActions(data.actions ?? []);
    } catch {}
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedActions([]);
      } else {
        setSelectedId(id);
        loadActions(id);
      }
    },
    [selectedId, loadActions],
  );

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
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Предложенные сети
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 28 }}>
          Предложения пользователей по построению устойчивой сетевой инфраструктуры.
          Голосуйте за лучшие решения!
        </p>

        {loading && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}
        {error && <p style={{ color: 'var(--danger, #ff6b6b)' }}>Ошибка: {error}</p>}
        {voteError && <p style={{ color: 'var(--danger, #ff6b6b)', fontSize: 13 }}>Голосование: {voteError}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {proposals.map((p) => {
            const tally = tallies[p.id];
            const isSelected = selectedId === p.id;
            const remaining = timeRemaining(p.votingEndsAt);

            return (
              <div
                key={p.id}
                className="networks-proposal-card"
                style={{
                  background: isSelected ? 'rgba(120,160,255,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? 'rgba(120,160,255,0.3)' : 'rgba(232,236,255,0.10)'}`,
                  borderRadius: 12,
                  padding: '18px 22px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => handleSelect(p.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                      {p.title || 'Без названия'}
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
                  </div>
                  {remaining && (
                    <span style={{ fontSize: 11, color: '#f6c177', whiteSpace: 'nowrap' }}>{remaining}</span>
                  )}
                </div>

                {p.description && (
                  <p style={{ fontSize: 13, color: 'rgba(200,220,255,0.7)', margin: '10px 0 0', lineHeight: 1.5 }}>
                    {p.description.length > 200 ? p.description.slice(0, 200) + '…' : p.description}
                  </p>
                )}

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
                    style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link href={`/networks/${p.id}`} style={{ textDecoration: 'none' }}>
                      <Button>Просмотр сети</Button>
                    </Link>
                    {p.status === 'SUBMITTED' && publicKey && (
                      <>
                        <Button
                          onClick={() => handleVote(p.id, 'FOR')}
                          disabled={voting || tally?.userVote != null}
                        >
                          {tally?.userVote === 'FOR' ? '✓ За' : 'За'}
                        </Button>
                        <Button
                          onClick={() => handleVote(p.id, 'AGAINST')}
                          disabled={voting || tally?.userVote != null}
                        >
                          {tally?.userVote === 'AGAINST' ? '✓ Против' : 'Против'}
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Expanded: show actions */}
                {isSelected && selectedActions.length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
                    <strong>Элементы ({selectedActions.length}):</strong>
                    <div className="networks-card-chips" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {selectedActions.slice(0, 10).map((a, i) => {
                        const payload = a.elementPayload as Record<string, unknown>;
                        return (
                          <span
                            key={i}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              background: 'rgba(120,160,255,0.12)',
                              border: '1px solid rgba(120,160,255,0.2)',
                              fontSize: 11,
                            }}
                          >
                            {a.actionType} {String(payload.type || payload.name || '')}
                          </span>
                        );
                      })}
                      {selectedActions.length > 10 && (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>+{selectedActions.length - 10} ещё</span>
                      )}
                    </div>
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

        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <Link href="/" style={{ color: '#8ab4f8', textDecoration: 'none', fontSize: 14 }}>
            ← На главную
          </Link>
        </div>
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
