import type { ProposalStatus } from '@prisma/client';

export type ProposalMutationGateInput = {
  status: ProposalStatus;
  voteCount: number;
  onChainTxSignature: string | null;
};

function hasOnChainTxSignature(signature: string | null): boolean {
  return typeof signature === 'string' && signature.trim().length > 0;
}

/** POST /api/proposals/:id/actions — одиночный append только в DRAFT. */
export function canAppendSingleChangeAction(status: ProposalStatus): boolean {
  return status === 'DRAFT';
}

/**
 * POST /api/proposals/:id/sync-actions — DRAFT; SUBMITTED только без голосов и без on-chain фиксации.
 * (См. DEVELOPMENT_JOURNAL: редактор после submit-draft.)
 */
export function canReplaceActionsViaSandboxSync(input: ProposalMutationGateInput): boolean {
  if (input.status === 'DRAFT') return true;
  if (input.status === 'SUBMITTED') {
    return input.voteCount === 0 && !hasOnChainTxSignature(input.onChainTxSignature);
  }
  return false;
}

/** PATCH /api/proposals/:id — те же правила, что и для sync-actions. */
export function canPatchProposalMetadata(input: ProposalMutationGateInput): boolean {
  return canReplaceActionsViaSandboxSync(input);
}
