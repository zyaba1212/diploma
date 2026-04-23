'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { AdminApiError, fetchJsonWithTimeout } from '@/lib/adminFetch';
import { formatAuditAction, formatAuditMetaHuman, formatAuditTargetType } from '@/lib/auditDisplay';

type Row = {
  id: string;
  actorType: string;
  actorPubkey: string | null;
  staffSession: { id: string; role: string; pubkey: string | null } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: unknown;
  at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getUserWalletFromMeta(meta: unknown): string | null {
  if (!isRecord(meta)) return null;
  const pubkey = meta.pubkey;
  return typeof pubkey === 'string' && pubkey.length > 0 ? pubkey : null;
}

export function AdminAuditClient() {
  const [items, setItems] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  const loadPage = useCallback(async (opts: { reset: boolean; cursor?: string | null }) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (!opts.reset && opts.cursor) params.set('cursor', opts.cursor);
      const j = await fetchJsonWithTimeout<{ items: Row[]; nextCursor: string | null }>(
        `/api/admin/audit-log?${params.toString()}`,
        { method: 'GET' },
      );
      setItems((prev) => (opts.reset ? j.items : [...prev, ...j.items]));
      setNextCursor(j.nextCursor);
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage({ reset: true });
  }, [loadPage]);

  const copyWallet = useCallback(async (wallet: string) => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopiedWallet(wallet);
      setTimeout(() => setCopiedWallet((prev) => (prev === wallet ? null : prev)), 1500);
    } catch {
      // No-op: clipboard may be unavailable in some browser/privacy contexts.
    }
  }, []);

  return (
    <DataTable<Row>
      rows={items}
      rowKey={(r) => r.id}
      loading={loading && items.length === 0}
      error={err}
      columns={[
        { key: 'a', header: 'Когда', render: (r) => new Date(r.at).toLocaleString('ru-RU') },
        {
          key: 'ac',
          header: 'Действие',
          render: (r) => (
            <span
              style={{ fontSize: 13 }}
              title={r.action}
            >
              {formatAuditAction(r.action)}
            </span>
          ),
        },
        {
          key: 't',
          header: 'Объект',
          render: (r) => {
            const objectLabel = formatAuditTargetType(r.targetType);
            const userWallet = r.targetType === 'User' ? getUserWalletFromMeta(r.meta) : null;

            if (userWallet) {
              const title = copiedWallet === userWallet ? 'Кошелёк скопирован' : `Скопировать кошелёк: ${userWallet}`;
              return (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--fg)',
                  }}
                >
                  {objectLabel}
                  <button
                    type="button"
                    onClick={() => void copyWallet(userWallet)}
                    title={title}
                    aria-label={title}
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      fontSize: 12,
                      color: 'var(--fg)',
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                  >
                    ⧉
                  </button>
                </span>
              );
            }

            return (
              <span style={{ fontSize: 12, color: 'var(--muted)' }} title={r.targetType ?? ''}>
                {objectLabel}
              </span>
            );
          },
        },
        {
          key: 'm',
          header: 'Смысл',
          render: (r) => {
            const raw = JSON.stringify(r.meta);
            return (
              <p
                style={{ fontSize: 13, margin: 0, maxWidth: 360, lineHeight: 1.35 }}
                title={`Технические данные: ${raw}`}
              >
                {formatAuditMetaHuman(r.action, r.meta)}
              </p>
            );
          },
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
  );
}
