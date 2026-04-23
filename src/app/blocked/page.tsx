'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';

type BanInfoResponse = {
  isBanned: boolean;
  pubkey?: string;
  bannedAt?: string;
  bannedReason?: string | null;
  bannedByPubkey?: string | null;
  bannedByUsername?: string | null;
};

function formatDateRu(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU');
  } catch {
    return iso;
  }
}

function formatBannedBy(data: BanInfoResponse): string {
  const byUsername = data.bannedByUsername?.trim();
  const byPubkey = data.bannedByPubkey?.trim();
  if (byUsername && byPubkey) return `${byUsername} (${byPubkey})`;
  if (byUsername) return byUsername;
  if (byPubkey) return byPubkey;
  return 'Администратор';
}

export default function BlockedPage() {
  const walletPubkey = useAuthorPubkey();
  const searchParams = useSearchParams();
  const queryPubkey = searchParams.get('pubkey')?.trim() || null;
  const pubkey = queryPubkey || walletPubkey;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ban, setBan] = useState<BanInfoResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!pubkey) {
        setBan(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/profile/ban-info?pubkey=${encodeURIComponent(pubkey)}`, { cache: 'no-store' });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setBan(null);
          return;
        }
        const data = (await res.json()) as BanInfoResponse;
        if (!cancelled) setBan(data);
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить информацию о блокировке.');
          setBan(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  const isBanned = ban?.isBanned === true;
  const bannerText = useMemo(() => {
    if (!pubkey) return 'Для просмотра информации подключите кошелёк.';
    if (loading) return 'Загрузка информации о блокировке...';
    if (error) return error;
    if (!isBanned) return 'По этому кошельку активной блокировки нет.';
    return 'Доступ к сайту ограничен.';
  }, [pubkey, loading, error, isBanned]);

  return (
    <main style={{ minHeight: '100vh', padding: '84px 16px 24px', background: 'var(--bg, #0a0a12)', color: 'var(--text, #eee)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', border: '1px solid rgba(255,107,107,0.4)', borderRadius: 14, padding: 16, background: 'rgba(255,107,107,0.08)' }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>Аккаунт заблокирован</h1>
        <p style={{ marginTop: 8, marginBottom: 0, color: 'var(--muted)' }}>{bannerText}</p>
      </div>

      {isBanned ? (
        <section style={{ maxWidth: 720, margin: '12px auto 0', border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'rgba(255,255,255,0.04)' }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div><strong>Кошелек:</strong> {ban.pubkey ?? pubkey ?? '—'}</div>
            <div><strong>Когда забанен:</strong> {formatDateRu(ban.bannedAt)}</div>
            <div><strong>Кем забанен:</strong> {formatBannedBy(ban)}</div>
            <div><strong>Причина:</strong> {ban.bannedReason?.trim() || 'Причина не указана'}</div>
          </div>
        </section>
      ) : null}

      <div style={{ maxWidth: 720, margin: '12px auto 0' }}>
        <Link href="/" style={{ color: '#8ab4f8', textDecoration: 'none', fontWeight: 600 }}>
          На главную
        </Link>
      </div>
    </main>
  );
}
