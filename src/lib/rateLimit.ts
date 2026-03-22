type Bucket = {
  count: number;
  resetAt: number; // epoch ms
};

const globalAny = globalThis as unknown as {
  __diplomaRateBuckets?: Map<string, Bucket>;
};

function getBuckets(): Map<string, Bucket> {
  if (!globalAny.__diplomaRateBuckets) globalAny.__diplomaRateBuckets = new Map();
  return globalAny.__diplomaRateBuckets;
}

export function getClientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('x-real-ip') || h.get('cf-connecting-ip') || 'unknown';
}

/**
 * Simple in-memory rate limiting (best-effort, per-process).
 * Returns true if request is allowed, false if rate limited.
 */
export async function checkRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();

  // Optional abstraction hook: if Redis is configured AND the redis module is available,
  // we can use it. This keeps contract behavior (429 json) unchanged.
  if (process.env.RATE_LIMIT_BACKEND === 'redis' && process.env.REDIS_URL) {
    try {
      const ok = await tryCheckRedisRateLimit(key, max, windowMs);
      if (ok !== null) return ok;
    } catch {
      // Fallback to in-memory on any Redis issue.
    }
  }

  const buckets = getBuckets();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= max) return false;
  existing.count += 1;
  return true;
}

let redisClient: any | null = null;
let redisInitPromise: Promise<any> | null = null;

async function getRedisClient() {
  if (redisClient) return redisClient;
  if (redisInitPromise) return redisInitPromise;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  redisInitPromise = (async () => {
    // Dynamic import: keeps dependency optional.
    const mod = await import('redis');
    const client = mod.createClient({ url });
    await client.connect();
    redisClient = client;
    return client;
  })();

  return redisInitPromise;
}

async function tryCheckRedisRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = await getRedisClient();
  if (!client) return null;

  // Fixed-window: max requests within the window bucket.
  const bucket = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${windowMs}:${key}:${bucket}`;

  const value: number = await client.incr(redisKey);
  if (value === 1) {
    // EXPIRE in seconds.
    const ttlSeconds = Math.ceil(windowMs / 1000) + 1;
    await client.expire(redisKey, ttlSeconds);
  }

  return value <= max;
}

