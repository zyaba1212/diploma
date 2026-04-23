'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { AdminApiError, adminDeleteJson, adminJson, adminPatch, fetchJsonWithTimeout } from '@/lib/adminFetch';

export function AdminProposalDetailClient({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [rollbackReason, setRollbackReason] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const j = await fetchJsonWithTimeout<{ proposal: unknown }>(`/api/admin/proposals/${proposalId}`, { method: 'GET' });
      setData(j.proposal);
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    }
  }, [proposalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const forceCancel = useCallback(async () => {
    if (!cancelReason.trim()) {
      setErr('Укажите причину отмены');
      return;
    }
    setBusy(true);
    try {
      await fetchJsonWithTimeout(`/api/admin/proposals/${proposalId}`, adminPatch({ cancelReason: cancelReason.trim() }));
      setCancelReason('');
      await load();
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setBusy(false);
    }
  }, [proposalId, cancelReason, load]);

  const forceRollback = useCallback(async () => {
    setBusy(true);
    try {
      await fetchJsonWithTimeout(`/api/admin/proposals/${proposalId}/force-rollback`, adminJson({ reason: rollbackReason.trim() || undefined }));
      setRollbackReason('');
      await load();
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setBusy(false);
    }
  }, [proposalId, rollbackReason, load]);

  const hardDeleteFromDb = useCallback(async () => {
    if (!window.confirm('Удалить предложение и все связанные записи из БД безвозвратно?')) return;
    setBusy(true);
    try {
      await fetchJsonWithTimeout<{ ok: boolean }>(
        `/api/admin/proposals/${proposalId}`,
        adminDeleteJson({ reason: deleteReason.trim() || undefined }),
      );
      router.push('/admin/proposals');
      router.refresh();
    } catch (e) {
      setErr(e instanceof AdminApiError ? e.message : 'ошибка');
    } finally {
      setBusy(false);
    }
  }, [proposalId, deleteReason, router]);

  if (err && !data) return <p style={{ color: 'var(--danger)' }}>{err}</p>;
  if (!data) return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;

  const p = data as Record<string, unknown>;
  const statusStr = typeof p.status === 'string' ? p.status : '';

  return (
    <div>
      <p>
        <Link href="/admin/proposals" style={{ color: 'var(--accent)' }}>
          ← к списку
        </Link>
      </p>
      {err ? <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p> : null}

      <Panel title="Карточка">
        <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 400, margin: 0 }}>{JSON.stringify(p, null, 2)}</pre>
      </Panel>

      <Panel title="Принудительная отмена (CANCELLED)" style={{ marginTop: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Недоступно для статуса APPLIED — сначала откат.</p>
        <textarea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder="причина cancelReason"
          rows={2}
          style={{
            width: '100%',
            maxWidth: 480,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.2)',
            color: 'var(--text)',
            padding: 8,
            marginTop: 8,
          }}
        />
        <div style={{ marginTop: 8 }}>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void forceCancel()}>
            Отменить предложение
          </Button>
        </div>
      </Panel>

      <Panel title="Принудительный rollback (APPLIED / ACCEPTED)" style={{ marginTop: 12 }}>
        <textarea
          value={rollbackReason}
          onChange={(e) => setRollbackReason(e.target.value)}
          placeholder="комментарий в аудит (опционально)"
          rows={2}
          style={{
            width: '100%',
            maxWidth: 480,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.2)',
            color: 'var(--text)',
            padding: 8,
            marginTop: 8,
          }}
        />
        <div style={{ marginTop: 8 }}>
          <Button type="button" disabled={busy} onClick={() => void forceRollback()}>
            Выполнить rollback последнего history
          </Button>
        </div>
      </Panel>

      <Panel title="Жёсткое удаление из БД" style={{ marginTop: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Вызывает <code style={{ fontSize: 11 }}>DELETE /api/admin/proposals/[id]</code>. Для статуса{' '}
          <strong>APPLIED</strong> сначала откатите историю кнопкой выше, иначе API вернёт 409. Альтернатива без
          сервера: см. <code style={{ fontSize: 11 }}>scripts/sql/admin-hard-delete-proposal.sql.example</code>.
        </p>
        {statusStr === 'APPLIED' ? (
          <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>
            Сейчас статус APPLIED — удаление из БД заблокировано до полного rollback.
          </p>
        ) : null}
        <textarea
          value={deleteReason}
          onChange={(e) => setDeleteReason(e.target.value)}
          placeholder="причина в AuditLog (опционально)"
          rows={2}
          style={{
            width: '100%',
            maxWidth: 480,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.2)',
            color: 'var(--text)',
            padding: 8,
            marginTop: 8,
          }}
        />
        <div style={{ marginTop: 8 }}>
          <Button type="button" variant="danger" disabled={busy || statusStr === 'APPLIED'} onClick={() => void hardDeleteFromDb()}>
            Удалить предложение из БД
          </Button>
        </div>
      </Panel>
    </div>
  );
}
