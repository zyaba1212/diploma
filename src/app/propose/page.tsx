'use client';

// This page uses client-side wallet/hooks that may not be SSR-safe during build-time prerender.
// Force it to be rendered dynamically on request instead of being prerendered at build.
export const dynamic = 'force-dynamic';

/* eslint-disable react/jsx-no-bind */

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';
import { useSessionVerified } from '@/hooks/useSessionVerified';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { LocalScopeNetworkReferencePanel } from '@/components/proposals/LocalScopeNetworkReferencePanel';
import Link from 'next/link';
import { contentHashStableJson, type ActionForContentHash } from '@/lib/stage7/proposalContentHashCore';
type Scope = 'GLOBAL' | 'LOCAL';

type ProposalDTO = {
  id: string;
  scope: Scope;
  authorPubkey: string;
  status: string;
  title: string | null;
  description?: string | null;
  createdAt: string;
  pinned?: boolean;
};

type ProposalDetails = ProposalDTO & {
  contentHash?: string | null;
  actions?: Array<{
    actionType: string;
    targetElementId?: string | null;
    elementPayload: unknown;
  }>;
};

type HistoryEntryDTO = {
  id: string;
  proposalId: string;
  appliedAt: string;
  appliedByPubkey?: string | null;
};

type FetchState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: ProposalDTO[] };

type ChainSubmitState = {
  submitting: boolean;
  txSignature?: string;
  error?: string;
};

function formatHttpError(status: number, fallback?: string): string {
  if (status === 429) return 'Слишком много запросов. Попробуйте чуть позже.';
  if (status >= 500) return 'Ошибка сервера. Попробуйте повторить через минуту.';
  if (status === 401) return 'Требуется подпись/авторизация кошелька.';
  if (status === 403) return 'Доступ запрещён для этого действия.';
  if (status === 404) return 'Ресурс не найден.';
  if (status >= 400) return fallback || 'Некорректный запрос.';
  return fallback || `HTTP ${status}`;
}

async function readErrorMessage(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (json?.error) return formatHttpError(res.status, json.error);
  return formatHttpError(res.status);
}

function normalizeClientError(err: unknown): string {
  if (!(err instanceof Error)) return 'Неизвестная ошибка.';

  const msg = err.message || '';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Сетевая ошибка: проверьте соединение, VPN/прокси и CSP-политику.';
  }
  if (msg.toLowerCase().includes('user rejected')) {
    return 'Подпись отклонена в кошельке.';
  }
  return msg;
}

async function fetchJsonWithTimeoutAndRetry<T>(
  url: string,
  init: RequestInit | undefined,
  opts: { timeoutMs?: number; retries?: number },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retries = opts.retries ?? 1;

  let lastErr: unknown = undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      return (await res.json()) as T;
    } catch (err: unknown) {
      lastErr = err;

      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const msg = err instanceof Error ? err.message : '';
      const isNetworkish = msg.includes('Failed to fetch') || msg.includes('NetworkError');

      const retryable = isAbort || isNetworkish;
      if (attempt >= retries || !retryable) break;

      // Small backoff between retries.
      await new Promise((r) => window.setTimeout(r, 250 * (attempt + 1)));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Network request failed');
}

function ProposePageContent() {
  const wallet = useWallet();
  const authorPubkey = useAuthorPubkey();
  const sessionVerified = useSessionVerified();
  const searchParams = useSearchParams();
  const [proposalsState, setProposalsState] = useState<FetchState>({ status: 'idle' });
  const [scope, setScope] = useState<Scope>('GLOBAL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** После успешного POST — ссылка в редактор `/propose/edit/…`. */
  const [newlyCreatedProposalId, setNewlyCreatedProposalId] = useState<string | null>(null);
  const [chainSubmitState, setChainSubmitState] = useState<Record<string, ChainSubmitState>>({});

  // Stage 7: minimal UI to add actions, apply/rollback and show history.
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [proposalDetailsState, setProposalDetailsState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'success'; details: ProposalDetails }
  >({ status: 'idle' });

  const [historyState, setHistoryState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'success'; entries: HistoryEntryDTO[] }
  >({ status: 'idle' });

  const [actionType, setActionType] = useState<'CREATE' | 'UPDATE' | 'DELETE'>('CREATE');
  const [targetElementId, setTargetElementId] = useState('');
  const [elementPayloadText, setElementPayloadText] = useState<string>('{}');
  const [actionSubmitState, setActionSubmitState] = useState<{ submitting: boolean; error?: string; okActionId?: string }>({
    submitting: false,
  });

  const [applyState, setApplyState] = useState<{ submitting: boolean; error?: string; historyId?: string }>({
    submitting: false,
  });
  const [rollbackState, setRollbackState] = useState<{ submitting: boolean; error?: string; historyId?: string }>({
    submitting: false,
  });

  // Stage 8 perf: cache computed contentHash per proposal id (used by submit to chain).
  const contentHashCacheRef = useRef<Record<string, string>>({});

  const canUseProposals = Boolean(authorPubkey);

  const sortedProposals = useMemo(() => {
    if (proposalsState.status !== 'success') return [];
    const mine = [...proposalsState.data];
    const pin = (p: ProposalDTO) => (p.pinned ? 1 : 0);
    return mine.sort((a, b) => {
      const dPin = pin(b) - pin(a);
      if (dPin !== 0) return dPin;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [proposalsState]);

  // Выбор из ?open=… или последнее предложение из списка.
  useEffect(() => {
    const open = searchParams.get('open');
    if (open) {
      setSelectedProposalId(open);
      return;
    }
    setSelectedProposalId((prev) => {
      if (prev) return prev;
      return sortedProposals[0]?.id ?? null;
    });
  }, [searchParams, sortedProposals]);

  // Load proposal details (needed for contentHash/status) and history.
  useEffect(() => {
    let cancelled = false;
    if (!selectedProposalId) {
      setProposalDetailsState({ status: 'idle' });
      setHistoryState({ status: 'idle' });
      return;
    }

    setProposalDetailsState({ status: 'loading' });
    setHistoryState({ status: 'loading' });

    const detailsUrl = `/api/proposals/${encodeURIComponent(selectedProposalId)}`;
    const historyUrl = `/api/proposals/${encodeURIComponent(selectedProposalId)}/history`;

    fetchJsonWithTimeoutAndRetry<ProposalDetails>(detailsUrl, undefined, { timeoutMs: 8000, retries: 1 })
      .then((details) => {
        if (cancelled) return;
        setProposalDetailsState({ status: 'success', details });
        if (details?.id && details?.contentHash && typeof details.contentHash === 'string') {
          contentHashCacheRef.current[details.id] = details.contentHash;
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProposalDetailsState({
          status: 'error',
          error: normalizeClientError(err),
        });
      });

    fetchJsonWithTimeoutAndRetry<HistoryEntryDTO[]>(historyUrl, undefined, { timeoutMs: 8000, retries: 1 })
      .then((entries) => {
        if (cancelled) return;
        setHistoryState({ status: 'success', entries });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistoryState({
          status: 'error',
          error: normalizeClientError(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProposalId]);

  useEffect(() => {
    if (!authorPubkey) {
      setProposalsState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setProposalsState({ status: 'loading' });

    const listUrl = `/api/proposals?authorPubkey=${encodeURIComponent(authorPubkey)}`;
    fetchJsonWithTimeoutAndRetry<ProposalDTO[]>(listUrl, undefined, { timeoutMs: 8000, retries: 1 })
      .then((data) => {
        if (cancelled) return;
        setProposalsState({ status: 'success', data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProposalsState({
          status: 'error',
          error: normalizeClientError(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [authorPubkey]);

  async function refreshProposals() {
    if (!authorPubkey) return;
    const refreshed = await fetchJsonWithTimeoutAndRetry<ProposalDTO[]>(
      `/api/proposals?authorPubkey=${encodeURIComponent(authorPubkey)}`,
      undefined,
      { timeoutMs: 8000, retries: 1 },
    );
    setProposalsState({ status: 'success', data: refreshed });
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!authorPubkey) {
      setFormError('Для создания предложения подключите Phantom-кошелёк.');
      return;
    }
    if (!sessionVerified) {
      setFormError('Сначала нажмите «Авторизоваться» в шапке сайта.');
      return;
    }
    if (!title.trim()) {
      setFormError('Укажите заголовок предложения.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope,
          title: title.trim(),
          description: description.trim() || null,
          authorPubkey,
        }),
      });

      if (!res.ok) throw new Error(await readErrorMessage(res));

      const created = (await res.json()) as ProposalDTO;
      if (created?.id) setNewlyCreatedProposalId(created.id);

      setTitle('');
      setDescription('');

      // Refresh proposals list
      if (authorPubkey) await refreshProposals().catch(() => {});
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Не удалось создать предложение.');
    } finally {
      setSubmitting(false);
    }
  };

  async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function computeProposalContentHash(details: ProposalDetails): Promise<string> {
    const actions: ActionForContentHash[] = (details.actions ?? []).map((a) => ({
      actionType: a.actionType as ActionForContentHash['actionType'],
      ...(a.targetElementId != null ? { targetElementId: a.targetElementId } : {}),
      elementPayload: a.elementPayload,
    }));

    const stableJson = contentHashStableJson({
      scope: details.scope,
      title: details.title ?? null,
      description: details.description ?? null,
      actions,
    });

    return sha256Hex(stableJson);
  }

  async function fetchProposalDetails(id: string): Promise<ProposalDetails> {
    // Keep helper for compatibility with already-implemented flows,
    // but internally use shared timeout+retry for production UX.
    return fetchJsonWithTimeoutAndRetry<ProposalDetails>(
      `/api/proposals/${encodeURIComponent(id)}`,
      undefined,
      { timeoutMs: 8000, retries: 1 },
    );
  }

  async function fetchProposalHistory(id: string): Promise<HistoryEntryDTO[]> {
    return fetchJsonWithTimeoutAndRetry<HistoryEntryDTO[]>(
      `/api/proposals/${encodeURIComponent(id)}/history`,
      undefined,
      { timeoutMs: 8000, retries: 1 },
    );
  }

  async function submitProposalToChain(p: ProposalDTO) {
    if (!wallet.connected) {
      setChainSubmitState((prev) => ({
        ...prev,
        [p.id]: { submitting: false, error: 'Wallet not connected' },
      }));
      return;
    }
    if (!wallet.signMessage) {
      setChainSubmitState((prev) => ({
        ...prev,
        [p.id]: { submitting: false, error: 'signMessage not supported by wallet' },
      }));
      return;
    }
    if (!sessionVerified) {
      setChainSubmitState((prev) => ({
        ...prev,
        [p.id]: { submitting: false, error: 'Нажмите «Авторизоваться» в шапке сайта.' },
      }));
      return;
    }

    setChainSubmitState((prev) => ({
      ...prev,
      [p.id]: { submitting: true },
    }));

    try {
      // Stage 6 perf: contentHash depends on Proposal fields + actions.
      // Cache it to avoid stable stringify / sha256 recomputation on repeated clicks.
      let contentHash = contentHashCacheRef.current[p.id];
      if (!contentHash) {
        const details = await fetchProposalDetails(p.id);
        contentHash = await computeProposalContentHash(details);
        contentHashCacheRef.current[p.id] = contentHash;
      }
      const message = `diploma-z96a propose:${contentHash}`;
      const encoded = new TextEncoder().encode(message);
      const sigBytes = await wallet.signMessage(encoded);
      const signature = bs58.encode(sigBytes);

      const res = await fetch(`/api/proposals/${encodeURIComponent(p.id)}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentHash, signature }),
      });

      if (!res.ok) throw new Error(await readErrorMessage(res));
      const json = (await res.json().catch(() => ({}))) as { txSignature?: string };
      if (!json.txSignature) throw new Error('Missing txSignature in response');

      const txSignature = json.txSignature;
      setChainSubmitState((prev) => ({
        ...prev,
        [p.id]: { submitting: false, txSignature },
      }));

      await refreshProposals().catch(() => {
        // Even if refresh fails, txSignature is already visible for the user.
      });
    } catch (err: unknown) {
      setChainSubmitState((prev) => ({
        ...prev,
        [p.id]: { submitting: false, error: normalizeClientError(err) },
      }));
    }
  }

  function encodeMessage(message: string): Uint8Array {
    return new TextEncoder().encode(message);
  }

  async function signBase58AndSubmit(message: string, endpoint: string, body: Record<string, unknown>) {
    if (!wallet.connected) throw new Error('Wallet not connected');
    if (!wallet.signMessage) throw new Error('signMessage not supported by wallet');
    if (!sessionVerified) throw new Error('Нажмите «Авторизоваться» в шапке сайта.');

    const encoded = encodeMessage(message);
    const sigBytes = await wallet.signMessage(encoded);
    const signature = bs58.encode(sigBytes);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, signature }),
    });

    if (!res.ok) throw new Error(await readErrorMessage(res));
    const json = (await res.json().catch(() => ({}))) as { error?: string };

    return json;
  }

  async function submitChangeAction() {
    if (!selectedProposalId) return;
    if (proposalDetailsState.status !== 'success') return;
    if (proposalDetailsState.details.status !== 'DRAFT') {
      setActionSubmitState({ submitting: false, error: 'ChangeActions can be added only for DRAFT proposals' });
      return;
    }
    if (!canUseProposals) {
      setActionSubmitState({ submitting: false, error: 'Connect Phantom wallet' });
      return;
    }
    if (!wallet.connected) {
      setActionSubmitState({ submitting: false, error: 'Wallet not connected' });
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(elementPayloadText);
    } catch {
      setActionSubmitState({ submitting: false, error: 'elementPayload must be valid JSON' });
      return;
    }

    const trimmedTarget = targetElementId.trim();
    if ((actionType === 'UPDATE' || actionType === 'DELETE') && !trimmedTarget) {
      setActionSubmitState({ submitting: false, error: 'targetElementId is required for UPDATE/DELETE' });
      return;
    }

    setActionSubmitState({ submitting: true });
    try {
      const proposalId = selectedProposalId;
      const message = `diploma-z96a action:add:${proposalId}`;

      const json = await signBase58AndSubmit(message, `/api/proposals/${encodeURIComponent(proposalId)}/actions`, {
        actionType,
        targetElementId: trimmedTarget || null,
        elementPayload: parsedPayload,
      });

      const okActionId = typeof (json as any).actionId === 'string' ? (json as any).actionId : undefined;

      setActionSubmitState({ submitting: false, okActionId });
      await Promise.all([refreshProposals().catch(() => {}), refreshSelectedDetailsAndHistory().catch(() => {})]);
    } catch (err: unknown) {
      setActionSubmitState({ submitting: false, error: normalizeClientError(err) });
    }
  }

  async function applySelectedProposal() {
    if (!selectedProposalId) return;
    if (proposalDetailsState.status !== 'success') return;
    if (proposalDetailsState.details.status !== 'ACCEPTED') {
      setApplyState({ submitting: false, error: 'Apply allowed only for ACCEPTED proposals' });
      return;
    }
    const contentHash = proposalDetailsState.details.contentHash;
    if (!contentHash || typeof contentHash !== 'string') {
      setApplyState({ submitting: false, error: 'Missing Proposal.contentHash (Stage 6 fact required)' });
      return;
    }

    setApplyState({ submitting: true });
    try {
      const proposalId = selectedProposalId;
      const message = `diploma-z96a propose:apply:${proposalId}:${contentHash}`;

      const json = await signBase58AndSubmit(
        message,
        `/api/proposals/${encodeURIComponent(proposalId)}/apply`,
        {},
      );

      setApplyState({
        submitting: false,
        historyId: typeof (json as any).historyId === 'string' ? (json as any).historyId : undefined,
      });
      await Promise.all([refreshProposals().catch(() => {}), refreshSelectedDetailsAndHistory().catch(() => {})]);
    } catch (err: unknown) {
      setApplyState({ submitting: false, error: normalizeClientError(err) });
    }
  }

  async function rollbackSelectedProposal() {
    if (!selectedProposalId) return;
    if (proposalDetailsState.status !== 'success') return;
    if (proposalDetailsState.details.status !== 'APPLIED') {
      setRollbackState({ submitting: false, error: 'Rollback allowed only for APPLIED proposals' });
      return;
    }
    if (historyState.status !== 'success' || historyState.entries.length === 0) {
      setRollbackState({ submitting: false, error: 'No history to rollback' });
      return;
    }

    // Pick the latest history entry by appliedAt.
    let latest = historyState.entries[0];
    for (const h of historyState.entries) {
      if (new Date(h.appliedAt).getTime() > new Date(latest.appliedAt).getTime()) latest = h;
    }

    setRollbackState({ submitting: true });
    try {
      const proposalId = selectedProposalId;
      const message = `diploma-z96a propose:rollback:${proposalId}:${latest.id}`;

      const json = await signBase58AndSubmit(
        message,
        `/api/proposals/${encodeURIComponent(proposalId)}/rollback`,
        {},
      );

      setRollbackState({
        submitting: false,
        historyId: typeof (json as any).historyId === 'string' ? (json as any).historyId : latest.id,
      });
      await Promise.all([refreshProposals().catch(() => {}), refreshSelectedDetailsAndHistory().catch(() => {})]);
    } catch (err: unknown) {
      setRollbackState({ submitting: false, error: normalizeClientError(err) });
    }
  }

  async function refreshSelectedDetailsAndHistory() {
    if (!selectedProposalId) return;
    setProposalDetailsState({ status: 'loading' });
    setHistoryState({ status: 'loading' });

    const [detailsRes, historyRes] = await Promise.allSettled([
      fetchProposalDetails(selectedProposalId),
      fetchProposalHistory(selectedProposalId),
    ]);

    if (detailsRes.status === 'fulfilled') {
      const d = detailsRes.value;
      if (d?.id && d?.contentHash && typeof d.contentHash === 'string') {
        contentHashCacheRef.current[d.id] = d.contentHash;
      }
      setProposalDetailsState({ status: 'success', details: d });
    } else {
      setProposalDetailsState({
        status: 'error',
        error: detailsRes.reason instanceof Error ? detailsRes.reason.message : 'Unknown error',
      });
    }

    if (historyRes.status === 'fulfilled') {
      setHistoryState({ status: 'success', entries: historyRes.value });
    } else {
      setHistoryState({
        status: 'error',
        error: historyRes.reason instanceof Error ? historyRes.reason.message : 'Unknown error',
      });
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 24,
        paddingTop: 70,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        color: 'var(--text)',
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Propose / Предложения</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Режим создания/отслеживания предложений (Stage 5) и on-chain фиксации (Stage 6). Ниже —{' '}
        <a href="#belarus-network-model" style={{ color: 'var(--accent, #8ab4f8)' }}>
          эталонная логика сети для LOCAL (РБ)
        </a>
        .
      </p>

      <LocalScopeNetworkReferencePanel />

      {!wallet.connected ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Wallet disconnected: операции подписи недоступны. Если подпись/запросы блокируются в production, проверьте CSP
          для Phantom и сетевых запросов к API.
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxWidth: 1040,
        }}
      >
        <Panel title="Мои предложения">
          {!canUseProposals ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Подключите Phantom-кошелёк на главной странице, чтобы увидеть свои предложения.
            </div>
          ) : sortedProposals.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '4px 6px' }}>Title</th>
                    <th style={{ padding: '4px 6px' }}>Status</th>
                    <th style={{ padding: '4px 6px' }}>Scope</th>
                    <th style={{ padding: '4px 6px' }}>Created</th>
                    <th style={{ padding: '4px 6px' }}>Редактирование</th>
                    <th style={{ padding: '4px 6px' }}>Chain</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProposals.map((p) => (
                    <tr key={p.id}>
                      <td style={{ padding: '6px 6px', borderTop: '1px solid var(--border)' }}>
                        {p.title || '(без заголовка)'}
                      </td>
                      <td style={{ padding: '6px 6px', borderTop: '1px solid var(--border)' }}>
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: 999,
                            border: '1px solid var(--border)',
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: 0.3,
                          }}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td style={{ padding: '6px 6px', borderTop: '1px solid var(--border)' }}>
                        {p.scope}
                      </td>
                      <td
                        style={{
                          padding: '6px 6px',
                          borderTop: '1px solid var(--border)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {new Date(p.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '6px 6px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                        <Link
                          href={`/propose/edit/${encodeURIComponent(p.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent, #8ab4f8)' }}
                        >
                          Редактировать
                        </Link>
                      </td>
                      <td style={{ padding: '6px 6px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Button
                              type="button"
                              disabled={
                                chainSubmitState[p.id]?.submitting === true ||
                                !wallet.connected ||
                                !sessionVerified ||
                                p.status !== 'SUBMITTED'
                              }
                              onClick={() => submitProposalToChain(p)}
                            >
                              {chainSubmitState[p.id]?.submitting ? 'Submitting…' : 'Submit to chain'}
                            </Button>
                          </div>

                          {p.status !== 'SUBMITTED' ? (
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                              requires: SUBMITTED
                            </div>
                          ) : null}

                          {chainSubmitState[p.id]?.error ? (
                            <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                              {chainSubmitState[p.id]?.error}
                            </div>
                          ) : chainSubmitState[p.id]?.txSignature ? (
                            <div style={{ fontSize: 12 }}>
                              tx:{" "}
                              <span title={chainSubmitState[p.id]?.txSignature}>
                                  {chainSubmitState[p.id]?.txSignature!.slice(0, 6)}…
                                  {chainSubmitState[p.id]?.txSignature!.slice(-6)}
                                </span>
                              </div>
                            ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : proposalsState.status === 'loading' ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Загрузка предложений…</div>
          ) : proposalsState.status === 'error' ? (
            <div style={{ fontSize: 13, color: 'var(--danger)' }}>
              Не удалось загрузить предложения: {proposalsState.error}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              У вас пока нет предложений. Создайте первое ниже.
            </div>
          )}
        </Panel>

        <Panel title="Создать предложение">
          {newlyCreatedProposalId ? (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(120,160,255,0.35)',
                background: 'rgba(120,160,255,0.08)',
                fontSize: 13,
                color: 'var(--text)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span>Черновик создан.</span>
              <Link
                href={`/propose/edit/${encodeURIComponent(newlyCreatedProposalId)}`}
                style={{ color: 'var(--accent, #8ab4f8)', fontWeight: 600 }}
              >
                Открыть редактор сети
              </Link>
              <Button type="button" onClick={() => setNewlyCreatedProposalId(null)}>
                Скрыть
              </Button>
            </div>
          ) : null}
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Scope:</span>
              <Button type="button" onClick={() => setScope('GLOBAL')} disabled={scope === 'GLOBAL'}>
                GLOBAL
              </Button>
              <Button type="button" onClick={() => setScope('LOCAL')} disabled={scope === 'LOCAL'}>
                LOCAL
              </Button>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Краткое описание предложения"
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.25)',
                  color: 'var(--text)',
                  padding: '6px 8px',
                  fontSize: 13,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Подробнее опишите, какие изменения сети вы предлагаете."
                rows={4}
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.25)',
                  color: 'var(--text)',
                  padding: '6px 8px',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
            </label>

            {formError ? (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>{formError}</div>
            ) : !authorPubkey ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Для отправки предложения подключите Phantom-кошелёк.
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit" disabled={submitting || !authorPubkey || !sessionVerified}>
                {submitting ? 'Создание…' : 'Создать предложение'}
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="Stage 7: Actions / Apply / Rollback">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Selected proposal:</div>
              <select
                value={selectedProposalId ?? ''}
                onChange={(e) => setSelectedProposalId(e.target.value || null)}
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.25)',
                  color: 'var(--text)',
                  padding: '6px 8px',
                  fontSize: 13,
                }}
                disabled={sortedProposals.length === 0}
              >
                {sortedProposals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title ? p.title : p.id.slice(0, 8) + '…'}
                  </option>
                ))}
              </select>

              {proposalDetailsState.status === 'success' ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  status: {proposalDetailsState.details.status}
                  {proposalDetailsState.details.contentHash ? ' · contentHash: yes' : ' · contentHash: missing'}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Add ChangeAction</div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button type="button" disabled={actionType === 'CREATE'} onClick={() => setActionType('CREATE')}>
                  CREATE
                </Button>
                <Button type="button" disabled={actionType === 'UPDATE'} onClick={() => setActionType('UPDATE')}>
                  UPDATE
                </Button>
                <Button type="button" disabled={actionType === 'DELETE'} onClick={() => setActionType('DELETE')}>
                  DELETE
                </Button>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span>targetElementId (optional for CREATE)</span>
                <input
                  type="text"
                  value={targetElementId}
                  onChange={(e) => setTargetElementId(e.target.value)}
                  placeholder="NetworkElement.id (если UPDATE/DELETE)"
                  style={{
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'rgba(0,0,0,0.25)',
                    color: 'var(--text)',
                    padding: '6px 8px',
                    fontSize: 13,
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span>elementPayload (JSON)</span>
                <textarea
                  value={elementPayloadText}
                  onChange={(e) => setElementPayloadText(e.target.value)}
                  rows={5}
                  style={{
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'rgba(0,0,0,0.25)',
                    color: 'var(--text)',
                    padding: '6px 8px',
                    fontSize: 13,
                    resize: 'vertical',
                  }}
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Example JSON:
                  <span
                    style={{
                      marginLeft: 6,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    }}
                  >
                    {'{"type":"BASE_STATION","lat":0,"lng":0,"altitude":0,"name":"Example"}'}
                  </span>
                </div>
              </label>

              {actionSubmitState.error ? (
                <div style={{ fontSize: 12, color: 'var(--danger)' }}>{actionSubmitState.error}</div>
              ) : actionSubmitState.okActionId ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  actionId: {actionSubmitState.okActionId}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button
                  type="button"
                  disabled={
                    actionSubmitState.submitting ||
                    !wallet.connected ||
                    !sessionVerified ||
                    proposalDetailsState.status !== 'success' ||
                    proposalDetailsState.details.status !== 'DRAFT'
                  }
                  onClick={submitChangeAction}
                >
                  {actionSubmitState.submitting ? 'Adding…' : 'Add action'}
                </Button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Apply / Rollback</div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  type="button"
                  disabled={
                    applyState.submitting ||
                    !wallet.connected ||
                    !sessionVerified ||
                    proposalDetailsState.status !== 'success' ||
                    proposalDetailsState.details.status !== 'ACCEPTED' ||
                    !proposalDetailsState.details.contentHash
                  }
                  onClick={applySelectedProposal}
                >
                  {applyState.submitting ? 'Applying…' : 'Apply'}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={
                    rollbackState.submitting ||
                    !wallet.connected ||
                    !sessionVerified ||
                    proposalDetailsState.status !== 'success' ||
                    proposalDetailsState.details.status !== 'APPLIED' ||
                    historyState.status !== 'success' ||
                    historyState.entries.length === 0
                  }
                  onClick={rollbackSelectedProposal}
                >
                  {rollbackState.submitting ? 'Rolling back…' : 'Rollback'}
                </Button>
              </div>

              {applyState.error ? (
                <div style={{ fontSize: 12, color: 'var(--danger)' }}>{applyState.error}</div>
              ) : applyState.historyId ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>historyId: {applyState.historyId}</div>
              ) : null}

              {rollbackState.error ? (
                <div style={{ fontSize: 12, color: 'var(--danger)' }}>{rollbackState.error}</div>
              ) : rollbackState.historyId ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>historyId: {rollbackState.historyId}</div>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>History</div>

              {historyState.status === 'loading' || proposalDetailsState.status === 'loading' ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading history…</div>
              ) : historyState.status === 'error' ? (
                <div style={{ fontSize: 12, color: 'var(--danger)' }}>{historyState.error}</div>
              ) : historyState.status === 'success' && historyState.entries.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>No history entries yet.</div>
              ) : historyState.status === 'success' ? (
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                        <th style={{ padding: '6px 8px' }}>id</th>
                        <th style={{ padding: '6px 8px' }}>appliedAt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyState.entries.map((h) => (
                        <tr key={h.id}>
                          <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border)' }}>
                            {h.id.slice(0, 8)}…
                          </td>
                          <td style={{ padding: '6px 8px', borderTop: '1px solid var(--border)' }}>
                            {new Date(h.appliedAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>
    </main>
  );
}

export default function ProposePage() {
  return (
    <Suspense fallback={<main style={{ padding: 24, minHeight: '40vh', color: 'var(--muted)' }}>Загрузка…</main>}>
      <ProposePageContent />
    </Suspense>
  );
}
