/**
 * Восстанавливает элементы песочницы из цепочки ChangeAction (ожидаются в основном CREATE из редактора).
 */

import { isSandboxElementType, type SandboxDraftElement } from '@/lib/sandbox/sandboxDraft';
import { generateNextAutoName, parseDisplayName } from '@/lib/sandbox/autoName';

const CABLE_TYPES = new Set([
  'CABLE_UNDERGROUND_FIBER',
  'CABLE_UNDERGROUND_COPPER',
  'CABLE_FIBER',
  'CABLE_COPPER',
]);

function isCableType(t: string): boolean {
  return CABLE_TYPES.has(t);
}

let idSeq = 0;
function genTempId(): string {
  idSeq += 1;
  return `sb-${idSeq}-${Date.now()}`;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-5;
}

/**
 * Импорт CREATE-действий в порядке createdAt (как от API).
 */
export function proposalCreateActionsToSandboxElements(
  actions: Array<{ actionType: string; elementPayload: Record<string, unknown> }>,
): SandboxDraftElement[] {
  const ordered = actions.filter(a => a.actionType === 'CREATE');
  const result: SandboxDraftElement[] = [];

  function ensureNodeAt(lat: number, lng: number): string {
    const found = result.find(
      e => !isCableType(e.type) && near(e.lat, lat) && near(e.lng, lng),
    );
    if (found) return found.tempId;
    const tid = genTempId();
    result.push({
      tempId: tid,
      type: 'SERVER',
      name: generateNextAutoName('SERVER', result),
      lat,
      lng,
    });
    return tid;
  }

  for (const a of ordered) {
    const p = a.elementPayload;
    const typeRaw = p.type;
    if (typeof typeRaw !== 'string' || !isSandboxElementType(typeRaw)) continue;

    if (isCableType(typeRaw)) {
      const path = p.path;
      if (!Array.isArray(path) || path.length < 2) continue;
      const p0 = path[0] as Record<string, unknown>;
      const p1 = path[path.length - 1] as Record<string, unknown>;
      const lat0 = p0.lat;
      const lng0 = p0.lng;
      const lat1 = p1.lat;
      const lng1 = p1.lng;
      if (
        typeof lat0 !== 'number' ||
        typeof lng0 !== 'number' ||
        typeof lat1 !== 'number' ||
        typeof lng1 !== 'number'
      ) {
        continue;
      }
      const fromId = ensureNodeAt(lat0, lng0);
      const toId = ensureNodeAt(lat1, lng1);
      const parsed = parseDisplayName(typeof p.name === 'string' ? p.name : '');
      const baseName = parsed.base || generateNextAutoName(typeRaw, result);
      result.push({
        tempId: genTempId(),
        type: typeRaw,
        name: baseName,
        ...(parsed.caption ? { caption: parsed.caption } : {}),
        lat: lat0,
        lng: lng0,
        fromId,
        toId,
      });
    } else {
      const lat = p.lat;
      const lng = p.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const parsed = parseDisplayName(typeof p.name === 'string' ? p.name : '');
      const baseName = parsed.base || generateNextAutoName(typeRaw, result);
      result.push({
        tempId: genTempId(),
        type: typeRaw,
        name: baseName,
        ...(parsed.caption ? { caption: parsed.caption } : {}),
        lat,
        lng,
      });
    }
  }

  return result;
}
