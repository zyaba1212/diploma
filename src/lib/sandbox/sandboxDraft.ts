/**
 * Session draft for /sandbox: restores layout after navigation / refresh (same tab).
 * Key: sandbox-draft-v1 (versioned for future migrations).
 */

/** Global sandbox session (no proposal). */
export const SANDBOX_DRAFT_STORAGE_KEY = 'sandbox-draft-v1';

export const SANDBOX_DRAFT_VERSION = 1 as const;

/** All valid equipment / cable types from sandbox UI (must match page.tsx). */
export const SANDBOX_ELEMENT_TYPES = [
  'SERVER',
  'SWITCH',
  'MULTIPLEXER',
  'DEMULTIPLEXER',
  'BASE_STATION',
  'REGENERATOR',
  'SATELLITE',
  'SATELLITE_RASSVET',
  'MESH_RELAY',
  'SMS_GATEWAY',
  'VSAT_TERMINAL',
  'CABLE_UNDERGROUND_FIBER',
  'CABLE_UNDERGROUND_COPPER',
  'CABLE_FIBER',
  'CABLE_COPPER',
] as const;

export type SandboxDraftElementType = (typeof SANDBOX_ELEMENT_TYPES)[number];

export type SandboxDraftViewMode = 'MAP_2D' | 'GLOBE_3D';

export type SandboxDraftElement = {
  tempId: string;
  type: SandboxDraftElementType;
  name: string;
  /**
   * Пользовательская подпись (например, "соединяет камеры").
   * Хранится отдельно от `name`; в API сериализуется в одну строку.
   * Опциональна: старые черновики без поля валидируются как пустая подпись.
   */
  caption?: string;
  lat: number;
  lng: number;
  fromId?: string;
  toId?: string;
};

export type SandboxDraftV1 = {
  version: typeof SANDBOX_DRAFT_VERSION;
  /** Epoch ms when draft was last persisted. */
  savedAt: number;
  elements: SandboxDraftElement[];
  selectedType: SandboxDraftElementType | null;
  cableFromId: string | null;
  viewMode: SandboxDraftViewMode;
  savedCenter: { lat: number; lng: number };
  mapZoom: number;
};

const ELEMENT_TYPE_SET = new Set<string>(SANDBOX_ELEMENT_TYPES);

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isLatValid(lat: number): boolean {
  return lat >= -90 && lat <= 90;
}

function isLngValid(lng: number): boolean {
  return lng >= -180 && lng <= 180;
}

export function isSandboxElementType(t: unknown): t is SandboxDraftElementType {
  return typeof t === 'string' && ELEMENT_TYPE_SET.has(t);
}

export function isCableType(t: string): boolean {
  return (
    t === 'CABLE_UNDERGROUND_FIBER' ||
    t === 'CABLE_UNDERGROUND_COPPER' ||
    t === 'CABLE_FIBER' ||
    t === 'CABLE_COPPER'
  );
}

export function validateSandboxElement(raw: unknown): SandboxDraftElement | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.tempId !== 'string' || !o.tempId.trim()) return null;
  if (!isSandboxElementType(o.type)) return null;
  if (typeof o.name !== 'string') return null;
  if (o.caption !== undefined && typeof o.caption !== 'string') return null;
  if (!isFiniteNumber(o.lat) || !isFiniteNumber(o.lng)) return null;
  if (!isLatValid(o.lat) || !isLngValid(o.lng)) return null;

  if (isCableType(o.type)) {
    if (typeof o.fromId !== 'string' || typeof o.toId !== 'string') return null;
    if (!o.fromId.trim() || !o.toId.trim()) return null;
  } else {
    if (o.fromId !== undefined && typeof o.fromId !== 'string') return null;
    if (o.toId !== undefined && typeof o.toId !== 'string') return null;
  }

  return {
    tempId: o.tempId,
    type: o.type,
    name: o.name,
    ...(typeof o.caption === 'string' ? { caption: o.caption } : {}),
    lat: o.lat,
    lng: o.lng,
    ...(isCableType(o.type) ? { fromId: o.fromId as string, toId: o.toId as string } : {}),
  };
}

export function parseSandboxDraftV1(raw: unknown): SandboxDraftV1 | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SANDBOX_DRAFT_VERSION) return null;

  if (!Array.isArray(o.elements)) return null;
  const elements: SandboxDraftElement[] = [];
  for (const item of o.elements) {
    const el = validateSandboxElement(item);
    if (!el) return null;
    elements.push(el);
  }

  const selectedType =
    o.selectedType === null || o.selectedType === undefined
      ? null
      : isSandboxElementType(o.selectedType)
        ? o.selectedType
        : null;

  const cableFromId =
    o.cableFromId === null || o.cableFromId === undefined
      ? null
      : typeof o.cableFromId === 'string'
        ? o.cableFromId
        : null;

  if (o.viewMode !== 'MAP_2D' && o.viewMode !== 'GLOBE_3D') return null;

  const sc = o.savedCenter;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return null;
  const cr = sc as Record<string, unknown>;
  if (!isFiniteNumber(cr.lat) || !isFiniteNumber(cr.lng)) return null;
  if (!isLatValid(cr.lat) || !isLngValid(cr.lng)) return null;

  let mapZoom = 6;
  if (o.mapZoom !== undefined) {
    if (!isFiniteNumber(o.mapZoom)) return null;
    mapZoom = Math.min(18, Math.max(2, Math.round(o.mapZoom)));
  }

  let savedAt = 0;
  if (o.savedAt !== undefined) {
    if (!isFiniteNumber(o.savedAt)) return null;
    savedAt = Math.max(0, Math.floor(o.savedAt));
  }

  return {
    version: SANDBOX_DRAFT_VERSION,
    savedAt,
    elements,
    selectedType,
    cableFromId,
    viewMode: o.viewMode,
    savedCenter: { lat: cr.lat, lng: cr.lng },
    mapZoom,
  };
}

/** Per-proposal draft key, or global when `proposalId` is null/empty. */
export function getSandboxDraftStorageKey(proposalId: string | null | undefined): string {
  const id = typeof proposalId === 'string' ? proposalId.trim() : '';
  if (id) return `${SANDBOX_DRAFT_STORAGE_KEY}:${id}`;
  return SANDBOX_DRAFT_STORAGE_KEY;
}

export function readSandboxDraftFromStorage(proposalId: string | null = null): SandboxDraftV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getSandboxDraftStorageKey(proposalId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    return parseSandboxDraftV1(parsed);
  } catch {
    return null;
  }
}

export function writeSandboxDraftToStorage(draft: SandboxDraftV1, proposalId: string | null = null): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getSandboxDraftStorageKey(proposalId);
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}
