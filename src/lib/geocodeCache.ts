type CacheEntry<T> = {
  value: T;
  expiresAt: number; // epoch ms
};

const globalAny = globalThis as unknown as {
  __diplomaGeocodeCache?: Map<string, CacheEntry<unknown>>;
};

function getCache(): Map<string, CacheEntry<unknown>> {
  if (!globalAny.__diplomaGeocodeCache) globalAny.__diplomaGeocodeCache = new Map();
  return globalAny.__diplomaGeocodeCache;
}

// Simple in-memory TTL cache with LRU-ish eviction (Map iteration order).
const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes
const DEFAULT_MAX_ITEMS = 500;

export function getCachedGeocode<T>(key: string): T | null {
  const cache = getCache();
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  // LRU-like: refresh insertion order.
  cache.delete(key);
  cache.set(key, entry as CacheEntry<unknown>);
  return entry.value;
}

export function setCachedGeocode<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS) {
  const cache = getCache();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });

  // Evict oldest entries if over capacity.
  const maxItems = DEFAULT_MAX_ITEMS;
  while (cache.size > maxItems) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

