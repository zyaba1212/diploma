/**
 * Сериализация элементов песочницы в массив CREATE payloads для sync-actions / ревизий.
 */

const CABLE_TYPES = new Set([
  'CABLE_UNDERGROUND_FIBER',
  'CABLE_UNDERGROUND_COPPER',
  'CABLE_FIBER',
  'CABLE_COPPER',
]);

export function isSandboxCableType(type: string): boolean {
  return CABLE_TYPES.has(type);
}

export type SandboxElementForCreate = {
  tempId: string;
  type: string;
  name: string;
  caption?: string;
  lat: number;
  lng: number;
  fromId?: string;
  toId?: string;
};

/**
 * Склеивает базовое имя и пользовательскую подпись в одну строку для API:
 *  - "switch1 (соединяет камеры)" — если caption задан;
 *  - "switch1 (switch1)" — если caption пуст (по умолчанию).
 */
function buildDisplayName(base: string, caption: string | undefined): string {
  const safeBase = base.trim() || base;
  const cap = caption?.trim();
  return cap ? `${safeBase} (${cap})` : `${safeBase} (${safeBase})`;
}

export function sandboxElementsToCreatePayloads(elements: SandboxElementForCreate[]): Record<string, unknown>[] {
  return elements.map((el) => {
    const base = el.name || el.type;
    const payload: Record<string, unknown> = {
      type: el.type,
      scope: 'GLOBAL',
      name: buildDisplayName(base, el.caption),
      lat: el.lat,
      lng: el.lng,
    };
    if (isSandboxCableType(el.type) && el.fromId && el.toId) {
      const fromEl = elements.find((x) => x.tempId === el.fromId);
      const toEl = elements.find((x) => x.tempId === el.toId);
      if (fromEl && toEl) {
        payload.path = [
          { lat: fromEl.lat, lng: fromEl.lng },
          { lat: toEl.lat, lng: toEl.lng },
        ];
      }
    }
    return payload;
  });
}
