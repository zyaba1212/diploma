/**
 * Per-process in-flight coalescing: identical cache keys share one upstream fetch.
 */

const inflight = new Map<string, Promise<unknown>>();

export function coalesceGeocodeInflight<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(cacheKey) as Promise<T> | undefined;
  if (existing) return existing;

  const p = fn().finally(() => {
    inflight.delete(cacheKey);
  }) as Promise<T>;

  inflight.set(cacheKey, p);
  return p;
}
