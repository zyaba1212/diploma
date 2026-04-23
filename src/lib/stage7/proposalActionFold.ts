import { buildNetworkElementUpdateData } from '@/lib/stage7/networkElementOps';

export type ProposalActionFoldInput = {
  id: string;
  actionType: string;
  targetElementId?: string | null;
  elementPayload: Record<string, unknown>;
};

/**
 * Плоский снимок элемента для карты/глобуса на `/networks/[id]`.
 * Складывается из цепочки ChangeAction в порядке `createdAt` (как в API).
 */
export type ProposalDisplayElement = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function createKey(action: ProposalActionFoldInput): string {
  const p = action.elementPayload;
  if (typeof p.id === 'string' && p.id.trim()) return p.id.trim();
  if (typeof p.tempId === 'string' && p.tempId.trim()) return p.tempId.trim();
  return action.id;
}

function snapshotFromCreatePayload(payload: Record<string, unknown>): ProposalDisplayElement | null {
  const type = payload.type;
  if (typeof type !== 'string') return null;

  const el: ProposalDisplayElement = { type };
  if (typeof payload.name === 'string') el.name = payload.name;
  if (typeof payload.lat === 'number' && Number.isFinite(payload.lat)) el.lat = payload.lat;
  if (typeof payload.lng === 'number' && Number.isFinite(payload.lng)) el.lng = payload.lng;
  if (typeof payload.altitude === 'number' && Number.isFinite(payload.altitude)) el.altitude = payload.altitude;
  if (Array.isArray(payload.path)) el.path = payload.path;
  return el;
}

function normalizePath(path: unknown): Array<{ lat: number; lng: number }> | undefined {
  if (!Array.isArray(path)) return undefined;
  const out: Array<{ lat: number; lng: number }> = [];
  for (const pt of path) {
    if (!isPlainObject(pt)) continue;
    const lat = pt.lat;
    const lng = pt.lng;
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({ lat, lng });
    }
  }
  return out.length >= 2 ? out : undefined;
}

/**
 * Свернуть ChangeAction в актуальный набор элементов (CREATE + последующие UPDATE/DELETE).
 */
export function foldProposalActionsForDisplay(actions: ProposalActionFoldInput[]): ProposalDisplayElement[] {
  const byKey = new Map<string, ProposalDisplayElement>();

  for (const action of actions) {
    const t = action.actionType;

    if (t === 'CREATE') {
      if (!isPlainObject(action.elementPayload)) continue;
      const snap = snapshotFromCreatePayload(action.elementPayload);
      if (!snap) continue;
      const key = createKey(action);
      const path = normalizePath(snap.path);
      if (path) snap.path = path;
      byKey.set(key, { ...snap });
      continue;
    }

    if (t === 'UPDATE') {
      const key = typeof action.targetElementId === 'string' ? action.targetElementId : '';
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev) continue;
      const patch = buildNetworkElementUpdateData(action.elementPayload);
      const next: ProposalDisplayElement = { ...prev };
      if (typeof patch.type !== 'undefined') next.type = patch.type as string;
      if (typeof patch.name !== 'undefined') next.name = patch.name as string | undefined;
      if (typeof patch.lat !== 'undefined') next.lat = patch.lat as number | undefined;
      if (typeof patch.lng !== 'undefined') next.lng = patch.lng as number | undefined;
      if (typeof patch.altitude !== 'undefined') next.altitude = patch.altitude as number | undefined;
      if (typeof patch.path !== 'undefined') {
        const path = normalizePath(patch.path);
        if (path) next.path = path;
        else if (patch.path === null) delete next.path;
      }
      byKey.set(key, next);
      continue;
    }

    if (t === 'DELETE') {
      const key = typeof action.targetElementId === 'string' ? action.targetElementId : '';
      if (!key) continue;
      byKey.delete(key);
    }
  }

  return [...byKey.values()];
}
