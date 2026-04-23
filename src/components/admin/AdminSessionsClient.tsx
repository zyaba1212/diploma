'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { AdminApiError, fetchJsonWithTimeout } from '@/lib/adminFetch';

type Row = {
  id: string;
  type: 'STAFF' | 'USER';
  role: string;
  username: string | null;
  pubkey: string | null;
  createdAt: string;
  expiresAt: string | null;
};

type SessionsScope = 'all' | 'site' | 'staff';

type SessionsResponse = {
  items: Row[];
  userSessionsOk?: boolean;
};

function parsePubkeyLines(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AdminSessionsClient() {
  const [items, setItems] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedRowKey, setCopiedRowKey] = useState<string | null>(null);
  const [userSessionsOk, setUserSessionsOk] = useState(true);
  const [scope, setScope] = useState<SessionsScope>('all');

  const [pubkeyFilter, setPubkeyFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const pubkeyRef = useRef<HTMLTextAreaElement>(null);
  const filtersRef = useRef({ pubkeyFilter: '', dateFrom: '', dateTo: '' });
  filtersRef.current = { pubkeyFilter, dateFrom, dateTo };

  const load = useCallback(
    async (opts?: { pubkeys?: string[]; from?: string; to?: string }) => {
      setLoading(true);
      setErr(null);
      const pubkeys =
        opts?.pubkeys !== undefined
          ? opts.pubkeys
          : (() => {
              const p = parsePubkeyLines(filtersRef.current.pubkeyFilter);
              return p.length ? p : undefined;
            })();
      const from =
        opts?.from !== undefined
          ? opts.from
          : filtersRef.current.dateFrom.trim() || undefined;
      const to =
        opts?.to !== undefined ? opts.to : filtersRef.current.dateTo.trim() || undefined;

      try {
        const params = new URLSearchParams();
        params.set('scope', scope);
        if (pubkeys?.length) params.set('pubkeys', pubkeys.join(','));
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const qs = params.toString();
        const url = '/api/admin/sessions' + (qs ? `?${qs}` : '');
        const j = await fetchJsonWithTimeout<SessionsResponse>(url, { method: 'GET' });
        setItems(j.items ?? []);
        setUserSessionsOk(j.userSessionsOk !== false);
      } catch (e) {
        setErr(e instanceof AdminApiError ? e.message : 'ошибка');
        setUserSessionsOk(true);
      } finally {
        setLoading(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = useCallback(() => {
    const pubkeys = parsePubkeyLines(pubkeyFilter);
    const from = dateFrom.trim() || undefined;
    const to = dateTo.trim() || undefined;
    void load({ pubkeys: pubkeys.length ? pubkeys : undefined, from, to });
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

  const copyPubkey = useCallback(async (rowKey: string, text: string) => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRowKey(rowKey);
      window.setTimeout(() => setCopiedRowKey((k) => (k === rowKey ? null : k)), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const scopeHint =
    scope === 'all'
      ? 'Чтобы увидеть только входы на сайт (кошелёк, не админка), выберите «Сайт».'
      : null;

  return (
    <div>
      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}
      {!userSessionsOk ? (
        <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>
          Не удалось загрузить журнал входов на сайт (UserAuthSession). Проверьте миграции БД и лог сервера.
        </p>
      ) : null}
      {scopeHint ? (
        <p style={{ color: 'var(--muted)', marginBottom: 12, fontSize: 12 }}>{scopeHint}</p>
      ) : null}

      <div style={{ marginBottom: 12 }}>
        <span style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--muted)' }}>
          Источник
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              { id: 'all' as const, label: 'Все' },
              { id: 'site' as const, label: 'Сайт' },
              { id: 'staff' as const, label: 'Админка' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              onClick={() => setScope(opt.id)}
              style={{
                opacity: scope === opt.id ? 1 : 0.65,
                borderColor: scope === opt.id ? 'var(--text)' : undefined,
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

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
              resize: 'none',
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
          { key: 'r', header: 'роль', render: (r) => r.role },
          {
            key: 'u',
            header: 'username',
            render: (r) => (r.username ? <span style={{ fontSize: 13 }}>{r.username}</span> : '—'),
          },
          {
            key: 'p',
            header: 'pubkey',
            render: (r) => {
              const pk = r.pubkey;
              if (!pk) {
                return '—';
              }
              const rk = `${r.type}:${r.id}`;
              const copied = copiedRowKey === rk;
              const title = copied ? 'Адрес скопирован' : `Скопировать адрес: ${pk}`;
              return (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 11,
                  }}
                >
                  {pk}
                  <button
                    type="button"
                    onClick={() => void copyPubkey(rk, pk)}
                    title={title}
                    aria-label={title}
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      fontSize: 14,
                      color: 'var(--text)',
                      cursor: 'pointer',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    {copied ? '✓' : '⧉'}
                  </button>
                </span>
              );
            },
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
