import type { ProposalStatus } from '@prisma/client';

export type ProposalMutationGateInput = {
  status: ProposalStatus;
  voteCount: number;
  onChainTxSignature: string | null;
  /**
   * Закреплённое предложение + автор из узкого списка (см. pinnedGraphSupereditAuthors) —
   * разрешить замену ChangeAction / коммит ревизии в ACCEPTED/APPLIED.
   */
  pinnedGraphSuperedit?: boolean;
};

/** POST /api/proposals/:id/actions — одиночный append только в DRAFT. */
export function canAppendSingleChangeAction(status: ProposalStatus): boolean {
  return status === 'DRAFT';
}

/**
 * Разрешить интерактивное редактирование карты/глобуса в песочнице для автора.
 * Сохранение «в текущее предложение» может быть запрещено отдельно — см. {@link canCommitProposalGraphRevision}.
 */
export function canInteractEditSandboxProposal(meta: {
  status: ProposalStatus;
}): boolean {
  const st = meta.status;
  return (
    st === 'DRAFT' ||
    st === 'WITHDRAWN' ||
    st === 'SUBMITTED' ||
    st === 'ACCEPTED' ||
    st === 'APPLIED' ||
    st === 'REJECTED' ||
    st === 'CANCELLED'
  );
}

/**
 * POST /api/proposals/:id/sync-actions и POST .../revisions (commit head) —
 * DRAFT, WITHDRAWN, SUBMITTED (всегда, в т.ч. при голосах и on-chain фиксации).
 * Остальные статусы — false (см. риск рассинхрона голосов/contentHash в DEVELOPMENT_JOURNAL).
 */
export function canReplaceActionsViaSandboxSync(input: ProposalMutationGateInput): boolean {
  if (input.status === 'DRAFT') return true;
  if (input.status === 'WITHDRAWN') return true;
  if (input.status === 'SUBMITTED') return true;
  if (
    input.pinnedGraphSuperedit === true &&
    (input.status === 'ACCEPTED' || input.status === 'APPLIED')
  ) {
    return true;
  }
  return false;
}

/**
 * Алиас для семантики «зафиксировать граф в текущем Proposal».
 * Правила совпадают с {@link canReplaceActionsViaSandboxSync}.
 */
export function canCommitProposalGraphRevision(input: ProposalMutationGateInput): boolean {
  return canReplaceActionsViaSandboxSync(input);
}

/**
 * PATCH /api/proposals/:id (метаданные title/description).
 * Правила совпадают с {@link canReplaceActionsViaSandboxSync}.
 */
export function canPatchProposalMetadata(input: ProposalMutationGateInput): boolean {
  return canReplaceActionsViaSandboxSync(input);
}

/** Fork из песочницы: альтернатива in-place правкам (новый id и своя история ревизий). */
export function canForkProposalFromSandbox(): boolean {
  return true;
}
