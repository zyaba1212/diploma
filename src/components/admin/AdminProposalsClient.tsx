'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { AdminApiError, adminDeleteJson, adminPatch, fetchJsonWithTimeout } from '@/lib/adminFetch';

type Row = {
  id: string;
  status: string;
  title: string | null;
  authorPubkey: string;
  pinned: boolean;
  createdAt: string;
};

const STATUSES = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'APPLIED', 'CANCELLED', 'WITHDRAWN'] as const;

/** Одно русское слово в скобках к коду статуса. */
const STATUS_RU: Record<(typeof STATUSES)[number], string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Подано',
  ACCEPTED: 'Принято',
  REJECTED: 'Отклонено',
  APPLIED: 'Применено',
  CANCELLED: 'Отменено',
  WITHDRAWN: 'Снято автором',
};

function statusLabel(code: string): string {
  const c = code.trim().toUpperCase();
  const ru = STATUS_RU[c as keyof typeof STATUS_RU];
  return ru ? `${c} (${ru})` : code;
}

type PendingConfirm = {
  row: Row;
  toStatus: string;
  note: string;
};

function validateStatusChange(row: Row, toStatus: string, note: string): string | null {
  if (row.status === toStatus) {
    return 'Выберите другой статус или нажмите «Отмена».';
  }
  if (row.status === 'APPLIED') {
    return 'Пока статус APPLIED (Применено), смена запрещена: сначала полный rollback на карточке предложения.';
  }
  if (toStatus === 'APPLIED' && row.status !== 'APPLIED') {
    return 'В APPLIED (Применено) можно попасть только через сценарий применения изменений на сайте, не из админки.';
  }
  if (!note.trim()) {
    return 'Укажите комментарий — он обязателен и уйдёт в аудит (staffSetStatus).';
  }
  return null;
}

async function commitStatusChange(row: Row, toStatus: string, note: string): Promise<void> {
  const from = row.status;
  if (from === toStatus) return;
  await fetchJsonWithTimeout(
    `/api/admin/proposals/${row.id}`,
    adminPatch({ staffSetStatus: { status: toStatus, note: note.trim() } }),
  );
}

const editorSelectStyle: CSSProperties = {
  width: 300,
  maxWidth: 300,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'rgba(0,0,0,0.2)',
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
};

const editorTextareaStyle: CSSProperties = {
  width: 300,
  height: 88,
  maxWidth: 300,
  maxHeight: 88,
  minWidth: 300,
  minHeight: 88,
  resize: 'none',
  marginTop: 8,
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'rgba(0,0,0,0.2)',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

function StatusEditorCell({
  row,
  open,
  onToggle,
  draftStatus,
  setDraftStatus,
  draftNote,
  setDraftNote,
  onRequestConfirm,
  busy,
  formErr,
}: {
  row: Row;
  open: boolean;
  onToggle: () => void;
  draftStatus: string;
  setDraftStatus: (v: string) => void;
  draftNote: string;
  setDraftNote: (v: string) => void;
  onRequestConfirm: () => void;
  busy: boolean;
  formErr: string | null;
}) {
  return (
    <div style={{ position: 'relative', minWidth: 160 }}>
      <Button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        style={{ fontSize: 12, textAlign: 'left', maxWidth: 280 }}
      >
        {statusLabel(row.status)}
      </Button>
      {open ? (
        <div
          role="region"
          aria-label="Изменение статуса"
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
            zIndex: 2,
          }}
        >
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>
            Новый статус
            <select
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value)}
              style={{ ...editorSelectStyle, display: 'block', marginTop: 4 }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Комментарий / причина
            <textarea
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="обязательно: комментарий в аудит"
              style={editorTextareaStyle}
            />
          </label>
          {formErr ? (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--danger)' }}>{formErr}</p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <Button type="button" disabled={busy} onClick={() => void onRequestConfirm()}>
              Подтвердить
            </Button>
            <Button type="button" disabled={busy} onClick={() => onToggle()}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminProposalsClient() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [statusEditorId, setStatusEditorId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [statusFormErr, setStatusFormErr] = useState<string | null>(null);
  const [modalApplyErr, setModalApplyErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyProposalId = useCallback(async (id: string) => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((k) => (k === id ? null : k)), 2000);
    } catch {
      /* ignore */
    }
  }, []);

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

  const openStatusEditor = useCallback((row: Row) => {
    setStatusEditorId(row.id);
    setDraftStatus(row.status);
    setDraftNote('');
    setStatusFormErr(null);
    setErr(null);
  }, []);

  const closeStatusEditor = useCallback(() => {
    setStatusEditorId(null);
    setDraftNote('');
    setStatusFormErr(null);
  }, []);

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

  const requestFirstConfirm = useCallback(() => {
    if (!statusEditorId) return;
    const row = items.find((r) => r.id === statusEditorId);
    if (!row) return;
    const msg = validateStatusChange(row, draftStatus, draftNote);
    if (msg) {
      setStatusFormErr(msg);
      return;
    }
    setStatusFormErr(null);
    setModalApplyErr(null);
    setPendingConfirm({ row, toStatus: draftStatus, note: draftNote });
  }, [statusEditorId, items, draftStatus, draftNote]);

  const applyPending = useCallback(async () => {
    if (!pendingConfirm) return;
    setStatusBusyId(pendingConfirm.row.id);
    setModalApplyErr(null);
    try {
      await commitStatusChange(pendingConfirm.row, pendingConfirm.toStatus, pendingConfirm.note);
      setPendingConfirm(null);
      closeStatusEditor();
      await loadPage({ reset: true });
    } catch (e) {
      setModalApplyErr(e instanceof AdminApiError ? e.message : e instanceof Error ? e.message : 'ошибка');
    } finally {
      setStatusBusyId(null);
    }
  }, [pendingConfirm, closeStatusEditor, loadPage]);

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
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
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

      <Modal
        open={Boolean(pendingConfirm)}
        onClose={() => {
          if (!statusBusyId) {
            setPendingConfirm(null);
            setModalApplyErr(null);
          }
        }}
        title="Повторное подтверждение"
        width={560}
        footer={
          <>
            <Button
              type="button"
              disabled={Boolean(statusBusyId)}
              onClick={() => {
                setPendingConfirm(null);
                setModalApplyErr(null);
              }}
            >
              Назад
            </Button>
            <Button type="button" disabled={Boolean(statusBusyId)} onClick={() => void applyPending()}>
              {statusBusyId ? '…' : 'Применить изменения'}
            </Button>
          </>
        }
      >
        {pendingConfirm ? (
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>
            {modalApplyErr ? (
              <p style={{ marginTop: 0, color: 'var(--danger)', fontSize: 13 }}>{modalApplyErr}</p>
            ) : null}
            <p style={{ marginTop: 0 }}>Будет выполнено следующее действие:</p>
            <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
              <li>
                <strong>Статус:</strong> {statusLabel(pendingConfirm.row.status)} → {statusLabel(pendingConfirm.toStatus)}
              </li>
              <li>
                <strong>Предложение:</strong> {pendingConfirm.row.title ?? '(без названия)'}
              </li>
              <li>
                <strong>ID:</strong> <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{pendingConfirm.row.id}</span>
              </li>
              <li>
                <strong>Владелец (authorPubkey):</strong>{' '}
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {pendingConfirm.row.authorPubkey}
                </span>
              </li>
              {pendingConfirm.note.trim() ? (
                <li>
                  <strong>Комментарий / причина:</strong> {pendingConfirm.note.trim()}
                </li>
              ) : null}
            </ul>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>
              На сервер уходит <code style={{ fontSize: 11 }}>staffSetStatus</code>: обновление статуса, при необходимости запись
              модерации / сброс очереди, запись в журнал аудита. Статус <strong>APPLIED</strong> через админку недоступен; из{' '}
              <strong>APPLIED</strong> нельзя выйти без rollback.
            </p>
          </div>
        ) : null}
      </Modal>

      <div style={{ marginTop: 12 }}>
        <DataTable<Row>
          rows={items}
          rowKey={(r) => r.id}
          loading={loading && items.length === 0}
          error={err}
          columns={[
            {
              key: 'id',
              header: 'ID',
              render: (r) => {
                const copied = copiedId === r.id;
                const title = copied ? 'ID скопирован' : `Скопировать ID: ${r.id}`;
                return (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      maxWidth: '100%',
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 11,
                        wordBreak: 'break-all',
                        color: 'var(--muted)',
                      }}
                      title={r.id}
                    >
                      {r.id}
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void copyProposalId(r.id);
                      }}
                      title={title}
                      aria-label={title}
                      style={{
                        padding: 0,
                        marginTop: 1,
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
                    </Button>
                  </span>
                );
              },
            },
            {
              key: 't',
              header: 'title',
              render: (r) => (
                <span style={{ color: 'var(--accent)' }}>{r.title ?? r.id.slice(0, 8)}</span>
              ),
            },
            {
              key: 's',
              header: 'status',
              render: (r) => (
                <StatusEditorCell
                  row={r}
                  open={statusEditorId === r.id}
                  onToggle={() => {
                    if (statusEditorId === r.id) closeStatusEditor();
                    else openStatusEditor(r);
                  }}
                  draftStatus={statusEditorId === r.id ? draftStatus : r.status}
                  setDraftStatus={setDraftStatus}
                  draftNote={statusEditorId === r.id ? draftNote : ''}
                  setDraftNote={setDraftNote}
                  onRequestConfirm={requestFirstConfirm}
                  busy={statusBusyId === r.id}
                  formErr={statusEditorId === r.id ? statusFormErr : null}
                />
              ),
            },
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
