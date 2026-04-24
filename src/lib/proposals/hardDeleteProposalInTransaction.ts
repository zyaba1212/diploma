import type { Prisma } from '@prisma/client';

/**
 * Полностью удаляет предложение и связанные строки в одной транзакции.
 * Используется авторским `DELETE /api/proposals/[id]` и staff `DELETE /api/admin/proposals/[id]`.
 */
export async function hardDeleteProposalInTransaction(tx: Prisma.TransactionClient, proposalId: string): Promise<void> {
  await tx.vote.deleteMany({ where: { proposalId } });
  await tx.proposalFeedback.deleteMany({ where: { proposalId } });
  await tx.moderationDecision.deleteMany({ where: { proposalId } });
  await tx.historyEntry.deleteMany({ where: { proposalId } });
  await tx.changeAction.deleteMany({ where: { proposalId } });
  await tx.proposal.delete({ where: { id: proposalId } });
}
