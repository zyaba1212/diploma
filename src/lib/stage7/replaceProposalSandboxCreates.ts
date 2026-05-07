import type { Prisma, ProposalStatus, Scope } from '@prisma/client';
import { computeProposalContentHashHexFromDbActions } from '@/lib/stage7/proposalContentHashServer';

/**
 * Полная замена ChangeAction набором CREATE (как песочница / sync-actions), плюс пересчёт contentHash для SUBMITTED/WITHDRAWN.
 */
export async function replaceProposalChangeActionsWithCreatesInTx(
  tx: Prisma.TransactionClient,
  input: {
    proposalId: string;
    scope: Scope;
    title: string | null;
    description: string | null;
    status: ProposalStatus;
    payloads: Prisma.InputJsonObject[];
  },
): Promise<void> {
  const { proposalId, scope, title, description, status, payloads } = input;

  await tx.changeAction.deleteMany({ where: { proposalId } });
  for (const elementPayload of payloads) {
    await tx.changeAction.create({
      data: {
        proposalId,
        actionType: 'CREATE',
        targetElementId: null,
        elementPayload,
      },
    });
  }

  if (status === 'SUBMITTED' || status === 'WITHDRAWN') {
    const actions = await tx.changeAction.findMany({
      where: { proposalId },
      orderBy: { createdAt: 'asc' },
      select: { actionType: true, targetElementId: true, elementPayload: true },
    });
    const newHash = computeProposalContentHashHexFromDbActions({
      scope,
      title,
      description,
      actions,
    });
    await tx.proposal.update({
      where: { id: proposalId },
      data: { contentHash: newHash },
    });
  }
}
