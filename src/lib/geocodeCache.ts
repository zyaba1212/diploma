import { createHash } from 'crypto';
import {
  GEOCODE_STALE_BACKUP_TTL_MS,
} from '@/lib/geocode/constants';

type CacheEntry<T> = {
  value: T;
  expiresAt: number; // epoch ms
};

const globalAny = globalThis as unknown as {
  __diplomaGeocodeCache?: Map<string, CacheEntry<unknown>>;
  __diplomaGeocodeStale?: Map<string, CacheEntry<unknown>>;
};

function getCache(): Map<string, CacheEntry<unknown>> {
  if (!globalAny.__diplomaGeocodeCache) globalAny.__diplomaGeocodeCache = new Map();
  return globalAny.__diplomaGeocodeCache;
}

function getStaleCache(): Map<string, CacheEntry<unknown>> {
  if (!globalAny.__diplomaGeocodeStale) globalAny.__diplomaGeocodeStale = new Map();
  return globalAny.__diplomaGeocodeStale;
}

// Simple in-memory TTL cache with LRU-ish eviction (Map iteration order).
const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes
const DEFAULT_MAX_ITEMS = 500;

function redisGeocodeEnabled(): boolean {
  return !!process.env.REDIS_URL && process.env.GEOCODE_DISABLE_REDIS !== '1';
}

function redisPayloadKey(cacheKey: string): string {
  const h = createHash('sha256').update(cacheKey).digest('hex');
  return `gc:data:v1:${h}`;
}

function redisStaleKey(cacheKey: string): string {
  const h = createHash('sha256').update(cacheKey).digest('hex');
  return `gc:stale:v1:${h}`;
}

/** Lazy Redis client for geocode L2 cache (optional; separate connection from rate-limit Redis). */
let redisClient: ReturnType<typeof import('redis').createClient> | null = null;
let redisInitPromise: Promise<ReturnType<typeof import('redis').createClient> | null> | null = null;

async function getRedisGeocodeClient(): Promise<ReturnType<typeof import('redis').createClient> | null> {
  if (!redisGeocodeEnabled()) return null;
  if (redisClient) return redisClient;
  if (redisInitPromise) return redisInitPromise;

  redisInitPromise = (async () => {
    try {
      const mod = await import('redis');
      const url = process.env.REDIS_URL;
      if (!url) return null;
      const client = mod.createClient({ url });
      await client.connect();
      redisClient = client;
      return redisClient;
    } catch {
      return null;
    }
  })();

  return redisInitPromise;
}

/** Populate L1 after L2 hit (same TTL default as primary cache). */
export async function tryGetGeocodeFromRedis<T>(cacheKey: string): Promise<T | null> {
  const client = await getRedisGeocodeClient();
  if (!client) return null;
  try {
    const raw = await client.get(redisPayloadKey(cacheKey));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function fireAndForgetRedisGeocodeSet<T>(cacheKey: string, value: T, ttlMs: number): void {
  void (async () => {
    const client = await getRedisGeocodeClient();
    if (!client) return;
    try {
      const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
      await client.set(redisPayloadKey(cacheKey), JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      /* ignore */
    }
  })();
}

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

  if (redisGeocodeEnabled()) {
    fireAndForgetRedisGeocodeSet(key, value, ttlMs);
  }
}

/** Last-known-good payload for stale-if-error (memory + optional Redis). */
export function setStaleGeocodeBackup<T>(cacheKey: string, value: T): void {
  const store = getStaleCache();
  store.set(cacheKey, {
    value,
    expiresAt: Date.now() + GEOCODE_STALE_BACKUP_TTL_MS,
  });
  while (store.size > 200) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }

  void (async () => {
    const client = await getRedisGeocodeClient();
    if (!client) return;
    try {
      const ttlSeconds = Math.ceil(GEOCODE_STALE_BACKUP_TTL_MS / 1000);
      await client.set(redisStaleKey(cacheKey), JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      /* ignore */
    }
  })();
}

export async function getStaleGeocodeBackup<T>(cacheKey: string): Promise<T | null> {
  const store = getStaleCache();
  const entry = store.get(cacheKey) as CacheEntry<T> | undefined;
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  if (entry) store.delete(cacheKey);

  const client = await getRedisGeocodeClient();
  if (!client) return null;
  try {
    const raw = await client.get(redisStaleKey(cacheKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    store.set(cacheKey, {
      value,
      expiresAt: Date.now() + GEOCODE_STALE_BACKUP_TTL_MS,
    });
    return value;
  } catch {
    return null;
  }
}
