/**
 * Автонумерация имён элементов песочницы.
 *
 * Каждому типу соответствует короткий "base"-префикс в нижнем регистре
 * (например, `SWITCH` → `switch`, `CABLE_UNDERGROUND_FIBER` → `cable_underground_fiber`).
 * Имя нового элемента собирается как `<base><N>`, где `N` — минимальный
 * свободный номер начиная с 1 среди уже существующих элементов того же типа
 * (стратегия fill-gaps: после удаления `switch2` следующий новый switch
 * получит `switch2`).
 */

import { SANDBOX_ELEMENT_TYPES, type SandboxDraftElementType } from '@/lib/sandbox/sandboxDraft';

const AUTO_NAME_BASE_BY_TYPE: Record<SandboxDraftElementType, string> = {
  SERVER: 'server',
  SWITCH: 'switch',
  MULTIPLEXER: 'multiplexer',
  DEMULTIPLEXER: 'demultiplexer',
  BASE_STATION: 'base_station',
  REGENERATOR: 'regenerator',
  SATELLITE: 'satellite',
  SATELLITE_RASSVET: 'satellite_rassvet',
  MESH_RELAY: 'mesh_relay',
  SMS_GATEWAY: 'sms_gateway',
  VSAT_TERMINAL: 'vsat_terminal',
  CABLE_UNDERGROUND_FIBER: 'cable_underground_fiber',
  CABLE_UNDERGROUND_COPPER: 'cable_underground_copper',
  CABLE_FIBER: 'cable_fiber',
  CABLE_COPPER: 'cable_copper',
};

export function getAutoNameBase(type: string): string {
  if ((SANDBOX_ELEMENT_TYPES as readonly string[]).includes(type)) {
    return AUTO_NAME_BASE_BY_TYPE[type as SandboxDraftElementType];
  }
  return type.toLowerCase();
}

/** Экранирование regex-метасимволов в `base` (имена все из ASCII, но на всякий случай). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Генерирует следующее имя для типа `type` по уже существующим `elements`.
 *
 * Учитываются только элементы с тем же `type` и именами вида `^<base>(\d+)$`
 * (case-insensitive). Возвращает строку `<base><N>`, где `N` — минимальный
 * положительный целый номер, отсутствующий среди занятых.
 */
export function generateNextAutoName(
  type: string,
  elements: ReadonlyArray<{ type: string; name?: string | null }>,
): string {
  const base = getAutoNameBase(type);
  const re = new RegExp(`^${escapeRegex(base)}(\\d+)$`, 'i');
  const used = new Set<number>();
  for (const el of elements) {
    if (el.type !== type) continue;
    const name = typeof el.name === 'string' ? el.name.trim() : '';
    if (!name) continue;
    const m = re.exec(name);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) used.add(n);
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return `${base}${next}`;
}

/**
 * Парсит человекочитаемое имя вида `base (caption)` обратно на пару `{ base, caption }`.
 *
 * Если строка не соответствует шаблону — возвращает `{ base: trimmed, caption: '' }`.
 * Если `caption` совпадает с `base` (наш дефолт `switch1 (switch1)`) — caption считаем пустым.
 */
export function parseDisplayName(raw: string | null | undefined): { base: string; caption: string } {
  const s = (raw ?? '').trim();
  if (!s) return { base: '', caption: '' };
  // Жадный last-paren: захватываем содержимое самой внешней пары скобок в конце строки.
  const m = /^(.+?)\s*\((.*)\)\s*$/.exec(s);
  if (!m) return { base: s, caption: '' };
  const base = m[1].trim();
  const captionRaw = m[2].trim();
  if (captionRaw === base) return { base, caption: '' };
  return { base, caption: captionRaw };
}
