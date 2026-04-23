'use client';

import { useEffect, useState } from 'react';

import { Panel } from '@/components/ui/Panel';
import { AdminApiError, fetchJsonWithTimeout } from '@/lib/adminFetch';

type Stats = {
  role: string;
  users: { total: number; banned: number; moderators: number };
  sessions: { active: number };
  news: { total: number };
};

export function AdminOverviewClient() {
  const [data, setData] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await fetchJsonWithTimeout<Stats>('/api/admin/stats', { method: 'GET' });
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof AdminApiError ? e.message : 'ошибка загрузки');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) return <p style={{ color: 'var(--danger)' }}>{err}</p>;
  if (!data) return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      <Panel title="Пользователи">
        <div style={{ fontSize: 24, fontWeight: 700 }}>{data.users.total}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Забанено: {data.users.banned} · Модераторов (grant): {data.users.moderators}
        </div>
      </Panel>
      <Panel title="Активные staff-сессии">
        <div style={{ fontSize: 24, fontWeight: 700 }}>{data.sessions.active}</div>
      </Panel>
      <Panel title="Новости в кэше">
        <div style={{ fontSize: 24, fontWeight: 700 }}>{data.news.total}</div>
      </Panel>
    </div>
  );
}
