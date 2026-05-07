import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ProposalActionFoldInput } from '@/lib/stage7/proposalActionFold';
import {
  sandboxElementsToCreatePayloads,
  type SandboxElementForCreate,
} from '@/lib/sandbox/sandboxElementsToCreates';
import { proposalActionsToSandboxElementsFolded } from '@/lib/sandbox/foldedDisplayToSandboxElements';

export type SnapshotElementPayload = Record<string, unknown>;

function stablePayloadKey(p: Record<string, unknown>): string {
  const type = typeof p.type === 'string' ? p.type : '';
  const lat = typeof p.lat === 'number' ? p.lat.toFixed(5) : '';
  const lng = typeof p.lng === 'number' ? p.lng.toFixed(5) : '';
  let pathKey = '';
  const path = p.path;
  if (Array.isArray(path)) {
    const pts = path
      .map((pt) => {
        if (typeof pt !== 'object' || pt === null || Array.isArray(pt)) return '';
        const r = pt as Record<string, unknown>;
        const la = typeof r.lat === 'number' ? r.lat.toFixed(5) : '';
        const ln = typeof r.lng === 'number' ? r.lng.toFixed(5) : '';
        return `${la},${ln}`;
      })
      .join('|');
    pathKey = pts;
  }
  return `${type}|${lat}|${lng}|${pathKey}`;
}

/** Сводка изменений между двумя снимками (минимально для UI timeline). */
export function computeSnapshotDiffSummary(
  prev: SnapshotElementPayload[],
  next: SnapshotElementPayload[],
): { added: number; removed: number; changed: number } {
  const prevMap = new Map<string, SnapshotElementPayload>();
  const nextMap = new Map<string, SnapshotElementPayload>();
  for (const p of prev) {
    prevMap.set(stablePayloadKey(p), p);
  }
  for (const n of next) {
    nextMap.set(stablePayloadKey(n), n);
  }
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const k of nextMap.keys()) {
    if (!prevMap.has(k)) added += 1;
  }
  for (const k of prevMap.keys()) {
    if (!nextMap.has(k)) removed += 1;
  }
  const overlap = [...prevMap.keys()].filter((k) => nextMap.has(k));
  for (const k of overlap) {
    const a = JSON.stringify(prevMap.get(k));
    const b = JSON.stringify(nextMap.get(k));
    if (a !== b) changed += 1;
  }
  return { added, removed, changed };
}

/** Построить массив CREATE payloads из текущих ChangeAction предложения. */
export function createPayloadsFromProposalActions(actions: ProposalActionFoldInput[]): SnapshotElementPayload[] {
  const foldedInputs = actions.map((a) => ({
    id: a.id,
    actionType: a.actionType,
    targetElementId: a.targetElementId,
    elementPayload: a.elementPayload,
  }));
  const sandboxEls = proposalActionsToSandboxElementsFolded(foldedInputs) as SandboxElementForCreate[];
  return sandboxElementsToCreatePayloads(sandboxEls);
}

/**
 * Гарантирует baseline-ревизию и head для предложения (lazy backfill).
 * Вызывать внутри транзакции до создания новой ревизии.
 */
export async function ensureProposalRevisionBaseline(
  tx: Prisma.TransactionClient,
  proposalId: string,
  authorPubkey: string,
): Promise<{ headId: string }> {
  const p = await tx.proposal.findUnique({
    where: { id: proposalId },
    select: {
      headRevisionId: true,
      actions: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, actionType: true, targetElementId: true, elementPayload: true },
      },
    },
  });
  if (!p) throw new Error('proposal not found');
  if (p.headRevisionId) {
    return { headId: p.headRevisionId };
  }

  const payloads = createPayloadsFromProposalActions(p.actions as ProposalActionFoldInput[]);
  const baselineId = randomUUID();

  await tx.proposalRevision.create({
    data: {
      id: baselineId,
      proposalId,
      parentRevisionId: null,
      authorPubkey,
      message: 'Исходное состояние (baseline)',
      snapshot: payloads as unknown as Prisma.InputJsonValue,
      diffSummary: { added: 0, removed: 0, changed: 0 } as unknown as Prisma.InputJsonValue,
      isBaseline: true,
    },
  });

  await tx.proposal.update({
    where: { id: proposalId },
    data: { headRevisionId: baselineId },
  });

  return { headId: baselineId };
}
