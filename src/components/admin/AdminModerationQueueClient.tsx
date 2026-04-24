'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { AdminApiError, fetchJsonWithTimeout } from '@/lib/adminFetch';

type ProposalDTO = {
  id: string;
  scope: string;
  authorPubkey: string;
  status: string;
  title: string | null;
  description?: string | null;
  createdAt: string;
};

export function AdminModerationQueueClient() {
  const [items, setItems] = useState<ProposalDTO[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyById, setBusyById] = useState<Record<string, boolean>>({});
  const [commentById, setCommentById] = useState<Record<string, string>>({});
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const j = await fetchJsonWithTimeout<{ items: ProposalDTO[] }>('/api/admin/proposals?status=SUBMITTED&limit=50', {
        method: 'GET',
      });
      setItems(j.items ?? []);
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [items],
  );

  const decide = useCallback(
    async (id: string, toStatus: 'ACCEPTED' | 'REJECTED') => {
      setBusyById((b) => ({ ...b, [id]: true }));
      setErr(null);
      try {
        await fetchJsonWithTimeout(`/api/admin/moderation/${id}/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            toStatus,
            comment: commentById[id]?.trim() || undefined,
            rejectionReason: toStatus === 'REJECTED' ? rejectReasonById[id]?.trim() || undefined : undefined,
          }),
        });
        await load();
      } catch (e) {
        setErr(e instanceof AdminApiError ? e.message : 'ошибка');
      } finally {
        setBusyById((b) => ({ ...b, [id]: false }));
      }
    },
    [load, commentById, rejectReasonById],
  );

  if (loading) return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        Очередь модерации через staff-сессию (без Phantom-подписи). Для входа модератора используйте кошелёк с грантом или{' '}
        <code>MODERATOR_PUBKEYS</code> (deprecated).
      </p>
      {err ? <p style={{ color: 'var(--danger)', marginBottom: 8 }}>{err}</p> : null}
      {sorted.length === 0 ? (
        <Panel title="SUBMITTED">Нет предложений в очереди.</Panel>
      ) : (
        sorted.map((p) => (
          <Panel key={p.id} title={p.title ?? p.id} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              <div>id: {p.id}</div>
              <div>scope: {p.scope}</div>
              <div>author: {p.authorPubkey}</div>
              <div>created: {new Date(p.createdAt).toLocaleString('ru-RU')}</div>
            </div>
            {p.description ? <p style={{ fontSize: 13, marginTop: 8 }}>{p.description}</p> : null}
            <label style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              Комментарий
              <textarea
                value={commentById[p.id] ?? ''}
                onChange={(e) => setCommentById((m) => ({ ...m, [p.id]: e.target.value }))}
                rows={2}
                style={{
                  width: '100%',
                  marginTop: 4,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.2)',
                  color: 'var(--text)',
                  padding: 6,
                }}
              />
            </label>
            <label style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              Причина отказа (для REJECTED)
              <input
                value={rejectReasonById[p.id] ?? ''}
                onChange={(e) => setRejectReasonById((m) => ({ ...m, [p.id]: e.target.value }))}
                style={{
                  width: '100%',
                  marginTop: 4,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.2)',
                  color: 'var(--text)',
                  padding: 6,
                }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button type="button" disabled={busyById[p.id]} onClick={() => void decide(p.id, 'ACCEPTED')}>
                Принять
              </Button>
              <Button type="button" variant="danger" disabled={busyById[p.id]} onClick={() => void decide(p.id, 'REJECTED')}>
                Отклонить
              </Button>
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
