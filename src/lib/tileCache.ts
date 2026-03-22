/**
 * In-memory LRU-ish cache for map tile bytes (per server process).
 * Снижает повторные запросы к upstream и нагрузку на rate limit.
 */

type TileEntry = {
  buf: ArrayBuffer;
  contentType: string;
  expiresAt: number;
};

const globalAny = globalThis as unknown as {
  __diplomaTileCache?: Map<string, TileEntry>;
};

const MAX_ENTRIES = 2048;
const TTL_MS = 24 * 60 * 60 * 1000;

function getMap(): Map<string, TileEntry> {
  if (!globalAny.__diplomaTileCache) globalAny.__diplomaTileCache = new Map();
  return globalAny.__diplomaTileCache;
}

export function getCachedTile(key: string): { buf: ArrayBuffer; contentType: string } | null {
  const cache = getMap();
  const e = cache.get(key);
  if (!e || Date.now() >= e.expiresAt) {
    if (e) cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, e);
  return { buf: e.buf, contentType: e.contentType };
}

export function setCachedTile(key: string, buf: ArrayBuffer, contentType: string): void {
  const cache = getMap();
  while (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next().value as string | undefined;
    if (first === undefined) break;
    cache.delete(first);
  }
  cache.set(key, {
    buf: buf.slice(0),
    contentType,
    expiresAt: Date.now() + TTL_MS,
  });
}
