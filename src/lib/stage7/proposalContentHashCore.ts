import type { ChangeActionType } from '@prisma/client';

export type ActionForContentHash = {
  actionType: ChangeActionType;
  targetElementId?: string;
  elementPayload: unknown;
};

/**
 * Deterministic JSON serialization (must match `stableStringify` in
 * `src/app/api/proposals/[id]/submit/route.ts` and Stage 5+ docs).
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'undefined') continue;
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  return JSON.stringify(value);
}

/**
 * Canonical UTF-8 input for SHA-256 contentHash (Stage 6 v1).
 */
export function contentHashStableJson(input: {
  scope: string;
  title: string | null;
  description: string | null;
  actions: ActionForContentHash[];
}): string {
  const proposalFields: { scope: string; title?: string; description?: string } = { scope: input.scope };
  if (input.title != null) proposalFields.title = input.title;
  if (input.description != null) proposalFields.description = input.description;

  const actions = input.actions.map((a) => ({
    actionType: a.actionType,
    ...(a.targetElementId != null ? { targetElementId: a.targetElementId } : {}),
    elementPayload: a.elementPayload,
  }));

  return stableStringify({ proposalFields, actions });
}
