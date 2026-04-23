'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Panel } from '@/components/ui/Panel';
import { AdminApiError, adminDeleteJson, adminPatch, fetchJsonWithTimeout } from '@/lib/adminFetch';

type Row = {
  id: string;
  scope: string;
  status: string;
  title: string | null;
  authorPubkey: string;
  pinned: boolean;
  createdAt: string;
};

export function AdminProposalsClient() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPage = useCallback(
    async (opts: { reset: boolean; cursor?: string | null }) => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (q.trim()) params.set('q', q.trim());
        if (!opts.reset && opts.cursor) params.set('cursor', opts.cursor);
        const j = await fetchJsonWithTimeout<{ items: Row[]; nextCursor: string | null }>(
          `/api/admin/proposals?${params.toString()}`,
          { method: 'GET' },
        );
        setItems((prev) => (opts.reset ? j.items : [...prev, ...j.items]));
        setNextCursor(j.nextCursor);
      } catch (e) {
        setErr(e instanceof AdminApiError ? e.message : 'ошибка');
      } finally {
        setLoading(false);
      }
    },
    [status, q],
  );

  useEffect(() => {
    setNextCursor(null);
    setItems([]);
    void loadPage({ reset: true });
  }, [status, q, loadPage]);

  const togglePin = useCallback(
    async (row: Row) => {
      try {
        await fetchJsonWithTimeout(`/api/admin/proposals/${row.id}`, adminPatch({ pinned: !row.pinned }));
        await loadPage({ reset: true });
      } catch (e) {
        setErr(e instanceof AdminApiError ? e.message : 'ошибка');
      }
    },
    [loadPage],
  );

  const hardDeleteRow = useCallback(
    async (row: Row) => {
      if (row.status === 'APPLIED') return;
      if (!window.confirm('Удалить предложение и связанные записи из БД безвозвратно?')) return;
      setDeletingId(row.id);
      setErr(null);
      try {
        await fetchJsonWithTimeout<{ ok: boolean }>(
          `/api/admin/proposals/${row.id}`,
          adminDeleteJson({}),
        );
        await loadPage({ reset: true });
      } catch (e) {
        setErr(e instanceof AdminApiError ? e.message : 'ошибка');
      } finally {
        setDeletingId(null);
      }
    },
    [loadPage],
  );

  return (
    <div>
      <Panel title="Фильтры">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>
            Статус{' '}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ marginLeft: 4, padding: 6, borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', color: 'var(--text)' }}
            >
              <option value="">все</option>
              <option value="DRAFT">DRAFT</option>
              <option value="SUBMITTED">SUBMITTED</option>
              <option value="ACCEPTED">ACCEPTED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="APPLIED">APPLIED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="поиск по title / id"
            style={{
              flex: 1,
              minWidth: 200,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'rgba(0,0,0,0.2)',
              color: 'var(--text)',
              fontSize: 13,
            }}
          />
        </div>
      </Panel>

      <div style={{ marginTop: 12 }}>
        <DataTable<Row>
          rows={items}
          rowKey={(r) => r.id}
          loading={loading && items.length === 0}
          error={err}
          columns={[
            {
              key: 't',
              header: 'title',
              render: (r) => (
                <Link href={`/admin/proposals/${r.id}`} style={{ color: 'var(--accent)' }} prefetch={false}>
                  {r.title ?? r.id.slice(0, 8)}
                </Link>
              ),
            },
            { key: 's', header: 'status', render: (r) => r.status },
            { key: 'sc', header: 'scope', render: (r) => r.scope },
            {
              key: 'p',
              header: 'pin',
              render: (r) => (
                <Button type="button" onClick={() => void togglePin(r)}>
                  {r.pinned ? 'unpin' : 'pin'}
                </Button>
              ),
            },
            {
              key: 'a',
              header: 'author',
              render: (r) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.authorPubkey.slice(0, 10)}…</span>,
            },
            {
              key: 'del',
              header: 'удалить',
              render: (r) => (
                <Button
                  type="button"
                  variant="danger"
                  disabled={deletingId === r.id || r.status === 'APPLIED'}
                  title={r.status === 'APPLIED' ? 'Сначала rollback на странице карточки' : undefined}
                  onClick={() => void hardDeleteRow(r)}
                >
                  {deletingId === r.id ? '…' : 'Удалить'}
                </Button>
              ),
            },
          ]}
          footer={
            nextCursor ? (
              <Button type="button" disabled={loading} onClick={() => void loadPage({ reset: false, cursor: nextCursor })}>
                {loading ? '…' : 'Ещё'}
              </Button>
            ) : null
          }
        />
      </div>
    </div>
  );
}
