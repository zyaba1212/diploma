/**
 * Строит элементы песочницы из эффективного состояния сети (CREATE+UPDATE+DELETE),
 * как на странице просмотра предложения.
 */

import {
  foldProposalActionsForDisplay,
  type ProposalActionFoldInput,
} from '@/lib/stage7/proposalActionFold';
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

function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Типы из proposal, которых нет в палитре песочницы — показываем как SERVER с меткой. */
function mapToSandboxType(raw: string): { type: SandboxDraftElement['type']; nameSuffix: string } {
  if (isSandboxElementType(raw)) {
    return { type: raw, nameSuffix: '' };
  }
  return { type: 'SERVER', nameSuffix: ` [${raw}]` };
}

type PathPoint = { lat: number; lng: number };

function normalizePathFromFolded(el: Record<string, unknown>): PathPoint[] | null {
  const raw = el.path;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out: PathPoint[] = [];
  for (const pt of raw) {
    if (typeof pt !== 'object' || pt === null || Array.isArray(pt)) continue;
    const r = pt as Record<string, unknown>;
    const lat = coerceFiniteNumber(r.lat);
    const lng = coerceFiniteNumber(r.lng);
    if (lat === null || lng === null) continue;
    out.push({ lat, lng });
  }
  return out.length >= 2 ? out : null;
}

/**
 * Импорт для редактирования в песочнице из полной цепочки ChangeAction.
 */
export function proposalActionsToSandboxElementsFolded(
  actions: ProposalActionFoldInput[],
): SandboxDraftElement[] {
  const folded = foldProposalActionsForDisplay(actions);
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

  for (const el of folded) {
    const typeRaw = typeof el.type === 'string' ? el.type : '';
    if (!typeRaw) continue;

    if (isCableType(typeRaw)) {
      const path = normalizePathFromFolded(el);
      if (!path || path.length < 2) continue;
      const p0 = path[0];
      const p1 = path[path.length - 1];
      const fromId = ensureNodeAt(p0.lat, p0.lng);
      const toId = ensureNodeAt(p1.lat, p1.lng);
      if (!isSandboxElementType(typeRaw)) continue;
      const parsed = parseDisplayName(typeof el.name === 'string' ? el.name : '');
      const baseName = parsed.base || generateNextAutoName(typeRaw, result);
      result.push({
        tempId: genTempId(),
        type: typeRaw,
        name: baseName,
        ...(parsed.caption ? { caption: parsed.caption } : {}),
        lat: p0.lat,
        lng: p0.lng,
        fromId,
        toId,
      });
    } else {
      const lat = coerceFiniteNumber(el.lat);
      const lng = coerceFiniteNumber(el.lng);
      if (lat === null || lng === null) continue;
      const { type, nameSuffix } = mapToSandboxType(typeRaw);
      const incoming = typeof el.name === 'string' ? el.name : '';
      const parsed = parseDisplayName(incoming);
      const baseName = parsed.base
        ? parsed.base
        : (incoming.trim() ? incoming + nameSuffix : generateNextAutoName(type, result));
      result.push({
        tempId: genTempId(),
        type,
        name: baseName,
        ...(parsed.caption ? { caption: parsed.caption } : {}),
        lat,
        lng,
      });
    }
  }

  return result;
}
