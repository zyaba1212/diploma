'use client';

import { useCallback, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopyButton } from '@/components/ui/CopyButton';
import { DataTable } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { AdminApiError, adminJson, fetchJsonWithTimeout } from '@/lib/adminFetch';

type UserRow = {
  id: string;
  pubkey: string;
  username: string | null;
  createdAt: string;
  isAdmin: boolean;
  isModerator: boolean;
  bannedAt: string | null;
  bannedReason: string | null;
};

export function AdminUsersClient({ canGrantModerator = false }: { canGrantModerator?: boolean }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<UserRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [banReason, setBanReason] = useState('');
  const [confirmModerator, setConfirmModerator] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadPage = useCallback(async (opts: { reset: boolean; cursor?: string | null }) => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (!opts.reset && opts.cursor) params.set('cursor', opts.cursor);
      const j = await fetchJsonWithTimeout<{ items: UserRow[]; nextCursor: string | null }>(
        `/api/admin/users?${params.toString()}`,
        { method: 'GET' },
      );
      setItems((prev) => (opts.reset ? j.items : [...prev, ...j.items]));
      setNextCursor(j.nextCursor);
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    setNextCursor(null);
    setItems([]);
    void loadPage({ reset: true });
  }, [q, loadPage]);

  const assignModerator = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetchJsonWithTimeout<{ ok: boolean }>('/api/admin/moderators', adminJson({ pubkey: selected.pubkey }));
      setConfirmModerator(false);
      setSelected(null);
      setNextCursor(null);
      await loadPage({ reset: true });
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setBusy(false);
    }
  }, [selected, loadPage]);

  const revokeModerator = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetchJsonWithTimeout<{ ok: boolean }>(`/api/admin/moderators/${encodeURIComponent(selected.pubkey)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      setConfirmModerator(false);
      setSelected(null);
      setNextCursor(null);
      await loadPage({ reset: true });
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setBusy(false);
    }
  }, [selected, loadPage]);

  const banUser = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetchJsonWithTimeout<{ ok: boolean }>(
        `/api/admin/users/${encodeURIComponent(selected.pubkey)}/ban`,
        adminJson({ reason: banReason }),
      );
      setConfirmBan(false);
      setSelected(null);
      setBanReason('');
      setNextCursor(null);
      await loadPage({ reset: true });
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setBusy(false);
    }
  }, [selected, banReason, loadPage]);

  const unbanUser = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetchJsonWithTimeout<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(selected.pubkey)}/ban`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      setSelected(null);
      setNextCursor(null);
      await loadPage({ reset: true });
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setBusy(false);
    }
  }, [selected, loadPage]);

  return (
    <div>
      <Panel title="Поиск">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="username или pubkey"
          style={{
            width: '100%',
            maxWidth: 400,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.2)',
            color: 'var(--text)',
            fontSize: 13,
          }}
        />
      </Panel>

      <div style={{ marginTop: 12 }}>
        <DataTable<UserRow>
          rows={items}
          rowKey={(r) => r.id}
          loading={loading && items.length === 0}
          error={err}
          emptyMessage="Нет пользователей по запросу"
          onRowClick={(r) => setSelected(r)}
          columns={[
            { key: 'u', header: 'username', render: (r) => r.username ?? '—' },
            {
              key: 'p',
              header: 'pubkey',
              render: (r) => (
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, wordBreak: 'break-all' }}>{r.pubkey}</span>
              ),
            },
            {
              key: 'f',
              header: 'флаги',
              render: (r) => (
                <span style={{ fontSize: 12 }}>
                  {r.isAdmin ? 'ADMIN ' : ''}
                  {r.isModerator ? 'MOD ' : ''}
                  {r.bannedAt ? <span style={{ color: 'var(--danger)' }}>BAN</span> : ''}
                </span>
              ),
            },
            {
              key: 'c',
              header: 'создан',
              render: (r) => <span style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(r.createdAt).toLocaleDateString('ru-RU')}</span>,
            },
          ]}
          footer={
            nextCursor ? (
              <Button type="button" disabled={loading} onClick={() => void loadPage({ reset: false, cursor: nextCursor })}>
                {loading ? '…' : 'Загрузить ещё'}
              </Button>
            ) : null
          }
        />
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          setBanReason('');
          setConfirmBan(false);
          setConfirmModerator(false);
        }}
        title={selected ? `Пользователь ${selected.username ?? selected.pubkey.slice(0, 8)}…` : undefined}
        footer={
          selected ? (
            <>
              <CopyButton value={selected.pubkey} label="Копировать pubkey" />
              {canGrantModerator ? (
                <Button type="button" onClick={() => setConfirmModerator(true)}>
                  {selected.isModerator ? 'Снять модератора' : 'Назначить модератором'}
                </Button>
              ) : null}
              {selected.bannedAt ? (
                <Button type="button" onClick={() => void unbanUser()} disabled={busy}>
                  Снять бан
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setBanReason('');
                    setConfirmBan(true);
                  }}
                  disabled={busy}
                >
                  Забанить
                </Button>
              )}
            </>
          ) : null
        }
      >
        {selected ? (
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <strong>username</strong>
              <div>{selected.username ?? '—'}</div>
            </div>
            <div>
              <strong>pubkey</strong>
              <div style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{selected.pubkey}</div>
            </div>
            {selected.bannedAt && (
              <p style={{ color: 'var(--danger)' }}>
                Забанен: {selected.bannedAt ? new Date(selected.bannedAt).toLocaleString('ru-RU') : ''}
                {selected.bannedReason ? ` · ${selected.bannedReason}` : ''}
              </p>
            )}
          </div>
        ) : null}
      </Modal>

      {canGrantModerator ? (
        <ConfirmDialog
          open={confirmModerator}
          onClose={() => setConfirmModerator(false)}
          title={selected?.isModerator ? 'Снять роль модератора?' : 'Назначить модератором?'}
          message={
            selected ? (
              <>
                {selected.isModerator
                  ? 'Роль модератора будет снята у пользователя:'
                  : 'Роль модератора будет назначена пользователю:'}
                <div style={{ marginTop: 6 }}>
                  <div>
                    <strong>username:</strong> {selected.username ?? '—'}
                  </div>
                  <div>
                    <strong>pubkey:</strong> <code style={{ wordBreak: 'break-all' }}>{selected.pubkey}</code>
                  </div>
                </div>
              </>
            ) : null
          }
          busy={busy}
          onConfirm={selected?.isModerator ? revokeModerator : assignModerator}
        />
      ) : null}

      <ConfirmDialog
        open={confirmBan && Boolean(selected) && !selected?.bannedAt}
        onClose={() => {
          setConfirmBan(false);
          setBanReason('');
        }}
        title="Забанить пользователя?"
        confirmLabel="Подтвердить"
        danger
        busy={busy}
        onConfirm={banUser}
        message={
          selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div>
                  <strong>username:</strong> {selected.username ?? '—'}
                </div>
                <div>
                  <strong>pubkey:</strong> <code style={{ wordBreak: 'break-all' }}>{selected.pubkey}</code>
                </div>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Причина бана (опционально)</span>
                <textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  rows={3}
                  style={{
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'rgba(0,0,0,0.2)',
                    color: 'var(--text)',
                    padding: 8,
                    resize: 'none',
                  }}
                />
              </label>
            </div>
          ) : null
        }
      />
    </div>
  );
}
