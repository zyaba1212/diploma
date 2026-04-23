'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { AdminApiError, fetchJsonWithTimeout } from '@/lib/adminFetch';

type Row = {
  id: string;
  type: 'STAFF' | 'USER';
  role: string;
  pubkey: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export function AdminSessionsClient() {
  const [items, setItems] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [pubkeyFilter, setPubkeyFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const pubkeyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async (pubkeys?: string[], from?: string, to?: string) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (pubkeys?.length) params.set('pubkeys', pubkeys.join(','));
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const url = '/api/admin/sessions' + (qs ? `?${qs}` : '');
      const j = await fetchJsonWithTimeout<{ items: Row[] }>(url, { method: 'GET' });
      setItems(j.items ?? []);
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = useCallback(() => {
    const pubkeys = pubkeyFilter
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    void load(pubkeys, dateFrom || undefined, dateTo || undefined);
  }, [pubkeyFilter, dateFrom, dateTo, load]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        applyFilters();
      }
    },
    [applyFilters],
  );

  return (
    <div>
      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}
      <p style={{ margin: '0 0 12px 0', color: 'var(--muted)', fontSize: 12 }}>
        Здесь отображаются staff-сессии админ-панели и успешные входы пользователей через
        кошелек. Фильтры по кошелькам и датам применяются к обоим типам записей.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div style={{ flex: '1 1 280px', minWidth: 220 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
            Адреса кошельков
            <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>
              Shift+Enter — несколько
            </span>
          </label>
          <textarea
            ref={pubkeyRef}
            rows={3}
            value={pubkeyFilter}
            onChange={(e) => setPubkeyFilter(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={'wallet1...\nwallet2...'}
            style={{
              width: '100%',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>С</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>По</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            />
          </div>
        </div>

        <Button type="button" onClick={applyFilters}>
          Применить
        </Button>
      </div>

      <DataTable<Row>
        rows={items}
        rowKey={(r) => `${r.type}:${r.id}`}
        loading={loading}
        columns={[
          {
            key: 't',
            header: 'тип',
            render: (r) => r.type,
          },
          { key: 'r', header: 'роль', render: (r) => r.role },
          {
            key: 'p',
            header: 'pubkey',
            render: (r) => (
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                {r.pubkey ?? '—'}
              </span>
            ),
          },
          {
            key: 'cs',
            header: 'Начало сессии',
            render: (r) => new Date(r.createdAt).toLocaleString('ru-RU'),
          },
          {
            key: 'es',
            header: 'Конец сессии',
            render: (r) => (r.expiresAt ? new Date(r.expiresAt).toLocaleString('ru-RU') : '—'),
          },
        ]}
      />
    </div>
  );
}
