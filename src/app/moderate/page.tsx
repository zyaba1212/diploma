'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

type Scope = 'GLOBAL' | 'LOCAL';

type ProposalDTO = {
  id: string;
  scope: Scope;
  authorPubkey: string;
  status: string;
  title: string | null;
  description?: string | null;
  createdAt: string;
};

type ProfileJson = {
  username: string | null;
  usernameSetAt: string | null;
  inDatabase?: boolean;
};

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; proposals: ProposalDTO[] };

function formatHttpError(status: number, fallback?: string): string {
  if (status === 401) return 'Требуется подпись/авторизация (401).';
  if (status === 403) return 'Нет прав модератора для этого действия (403).';
  if (status === 429) return 'Слишком много запросов. Попробуйте позже (429).';
  if (status >= 500) return 'Ошибка сервера. Попробуйте позже.';
  if (status >= 400) return fallback || 'Некорректный запрос.';
  return fallback || `HTTP ${status}`;
}

async function readErrorMessage(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (json?.error) return formatHttpError(res.status, json.error);
  return formatHttpError(res.status);
}

async function fetchJsonWithTimeout<T>(url: string, opts: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(t);
  }
}

export default function ModeratePage() {
  const moderatorPubkey = useAuthorPubkey();

  const [state, setState] = useState<FetchState>({ status: 'idle' });
  const [busyById, setBusyById] = useState<Record<string, boolean>>({});
  const [lastActionError, setLastActionError] = useState<string | null>(null);
  const [authorUsernameByPubkey, setAuthorUsernameByPubkey] = useState<Record<string, string | null>>({});
  const [authorsLoading, setAuthorsLoading] = useState(false);

  const canModerate = Boolean(moderatorPubkey);

  const sortedSubmitted = useMemo(() => {
    if (state.status !== 'success') return [];
    return [...state.proposals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [state]);

  async function loadSubmitted() {
    if (!moderatorPubkey) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'loading' });
    setLastActionError(null);
    setAuthorsLoading(false);
    setAuthorUsernameByPubkey({});

    // Stage 12 backend may add moderation-specific list endpoints under /api/moderation/*.
    // Until then, we fall back to proposals list filtered by status.
    // If moderation API becomes available, we can switch this URL without changing the UI.
    const url = `/api/proposals?status=SUBMITTED`;
    try {
      const proposals = await fetchJsonWithTimeout<ProposalDTO[]>(url, undefined, 8000);
      setState({ status: 'success', proposals });
      void hydrateAuthorUsernames(proposals);
    } catch (err: unknown) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async function hydrateAuthorUsernames(proposals: ProposalDTO[]) {
    const uniquePubkeys = Array.from(new Set(proposals.map((p) => p.authorPubkey))).filter(Boolean);
    if (uniquePubkeys.length === 0) return;
    setAuthorsLoading(true);
    try {
      // Prefer bulk endpoint (if backend supports it), fallback to N requests.
      try {
        const bulk = await fetchJsonWithTimeout<{
          ok?: boolean;
          usernamesByPubkey?: Record<string, string | null>;
        }>(
          '/api/profile/bulk',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pubkeys: uniquePubkeys }),
          },
          8000,
        );
        if (bulk.ok && bulk.usernamesByPubkey) {
          setAuthorUsernameByPubkey(bulk.usernamesByPubkey);
          return;
        }
      } catch {
        /* fallback below */
      }

      const entries = await Promise.all(
        uniquePubkeys.map(async (pk) => {
          try {
            const prof = await fetchJsonWithTimeout<ProfileJson>(
              `/api/profile?pubkey=${encodeURIComponent(pk)}`,
              undefined,
              8000,
            );
            return [pk, prof.username] as const;
          } catch {
            return [pk, null] as const;
          }
        }),
      );
      setAuthorUsernameByPubkey(Object.fromEntries(entries));
    } finally {
      setAuthorsLoading(false);
    }
  }

  useEffect(() => {
    loadSubmitted().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderatorPubkey]);

  async function decide(proposalId: string, status: 'ACCEPTED' | 'REJECTED') {
    if (!moderatorPubkey) {
      setLastActionError('Подключите Phantom-кошелёк модератора.');
      return;
    }

    setLastActionError(null);
    setBusyById((prev) => ({ ...prev, [proposalId]: true }));

    try {
      // Expected Stage 12 moderation contract (path may be aligned with backend by other agent):
      // POST /api/moderation/:id/decide { status, moderatorPubkey }
      const endpoint = `/api/moderation/${encodeURIComponent(proposalId)}/decide`;
      const body = { status, moderatorPubkey };

      let res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      // Fallback to a single decide endpoint if backend chooses a different shape.
      if (res.status === 404) {
        const fallbackRes = await fetch('/api/moderation/decide', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ proposalId, status, moderatorPubkey }),
        });
        res = fallbackRes;
      }

      if (!res.ok) throw new Error(await readErrorMessage(res));

      await loadSubmitted();
    } catch (err: unknown) {
      setLastActionError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusyById((prev) => ({ ...prev, [proposalId]: false }));
    }
  }

  return (
    <main style={{ padding: 24, paddingTop: 70, minHeight: '100vh', color: 'var(--text)' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Moderation / Модерация</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Принятие/отклонение предложений в статусе <b>SUBMITTED</b> (Stage 12).
      </p>

      {!canModerate ? (
        <Panel title="Доступ">
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Подключите Phantom-кошелёк. Если вы не в allowlist модераторов — кнопки будут недоступны/получите 401/403.
          </div>
        </Panel>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1040 }}>
        <Panel title="SUBMITTED proposals">
          {state.status === 'loading' ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Загрузка…</div>
          ) : state.status === 'error' ? (
            <div style={{ fontSize: 13, color: 'var(--danger)' }}>{state.error}</div>
          ) : state.status === 'success' && sortedSubmitted.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Нет предложений для модерации.</div>
          ) : state.status === 'success' ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '6px 8px' }}>Title</th>
                    <th style={{ padding: '6px 8px' }}>Scope</th>
                    <th style={{ padding: '6px 8px' }}>Author</th>
                    <th style={{ padding: '6px 8px' }}>Created</th>
                    <th style={{ padding: '6px 8px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSubmitted.map((p) => (
                    <tr key={p.id}>
                      <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border)' }}>
                        {p.title || '(без заголовка)'}
                      </td>
                      <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border)' }}>{p.scope}</td>
                      <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border)' }}>
                        {authorsLoading ? '—' : authorUsernameByPubkey[p.authorPubkey] ?? '—'}
                      </td>
                      <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                        {new Date(p.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Button
                            type="button"
                            disabled={busyById[p.id] === true}
                            onClick={() => decide(p.id, 'ACCEPTED')}
                          >
                            {busyById[p.id] === true ? 'Submitting…' : 'Accept'}
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            disabled={busyById[p.id] === true}
                            onClick={() => decide(p.id, 'REJECTED')}
                          >
                            {busyById[p.id] === true ? 'Submitting…' : 'Reject'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {lastActionError ? (
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>{lastActionError}</div>
          ) : null}
        </Panel>
      </div>
    </main>
  );
}

