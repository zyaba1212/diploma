import { createHash } from 'node:crypto';
import type { ChangeActionType, Scope } from '@prisma/client';
import { contentHashStableJson } from './proposalContentHashCore';

export function computeProposalContentHashHexFromDbActions(input: {
  scope: Scope;
  title: string | null;
  description: string | null;
  actions: Array<{
    actionType: ChangeActionType;
    targetElementId: string | null;
    elementPayload: unknown;
  }>;
}): string {
  const stableJson = contentHashStableJson({
    scope: input.scope,
    title: input.title,
    description: input.description,
    actions: input.actions.map((a) => ({
      actionType: a.actionType,
      ...(a.targetElementId != null ? { targetElementId: a.targetElementId } : {}),
      elementPayload: a.elementPayload,
    })),
  });
  return createHash('sha256').update(stableJson, 'utf8').digest('hex');
}
