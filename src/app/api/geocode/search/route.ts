import { NextResponse } from 'next/server';
import { createCorrelationId, internalApiError } from '@/lib/apiError';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import {
  getCachedGeocode,
  setCachedGeocode,
  tryGetGeocodeFromRedis,
} from '@/lib/geocodeCache';
import { GEOCODE_MEMORY_TTL_SEARCH_MS } from '@/lib/geocode/constants';
import { runNominatimJson } from '@/lib/geocode/nominatimUpstream';
import { logGeocodeServerEvent } from '@/lib/geocode/observability';

export const maxDuration = 60;

export async function GET(req: Request) {
  const correlationId = createCorrelationId();
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`geocode.search:${clientIp}`, 90, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const trimmed = q?.trim() || '';
  if (trimmed.length < 2) return NextResponse.json({ error: 'q too short' }, { status: 400 });
  if (trimmed.length > 200) return NextResponse.json({ error: 'q too long' }, { status: 400 });

  const cacheKey = `geocode:search:q:${trimmed}`;
  const mem = getCachedGeocode<unknown>(cacheKey);
  if (mem) {
    logGeocodeServerEvent({
      route: 'search',
      durationMs: 0,
      outcome: 'cache_memory_hit',
      correlationId,
    });
    return NextResponse.json(mem, {
      headers: {
        'cache-control': 'no-store',
        'x-correlation-id': correlationId,
        'x-geocode-cache': 'memory',
        'x-geocode-outcome': 'cache_memory_hit',
      },
    });
  }

  const redisHit = await tryGetGeocodeFromRedis<unknown>(cacheKey);
  if (redisHit) {
    setCachedGeocode(cacheKey, redisHit, GEOCODE_MEMORY_TTL_SEARCH_MS);
    logGeocodeServerEvent({
      route: 'search',
      durationMs: 0,
      outcome: 'cache_redis_hit',
      correlationId,
    });
    return NextResponse.json(redisHit, {
      headers: {
        'cache-control': 'no-store',
        'x-correlation-id': correlationId,
        'x-geocode-cache': 'redis',
        'x-geocode-outcome': 'cache_redis_hit',
      },
    });
  }

  const upstream = new URL('https://nominatim.openstreetmap.org/search');
  upstream.searchParams.set('q', trimmed);
  upstream.searchParams.set('format', 'json');
  upstream.searchParams.set('limit', '10');

  const result = await runNominatimJson<unknown>({
    routeLabel: 'search',
    circuitKey: 'geocode:search',
    cacheKey,
    upstreamUrl: upstream,
    ttlMs: GEOCODE_MEMORY_TTL_SEARCH_MS,
    correlationId,
  });

  if (!result.ok) {
    const msg =
      result.message === 'upstream error'
        ? 'geocode failed'
        : result.message === 'geocode temporarily unavailable'
          ? 'geocode temporarily unavailable'
          : 'geocode failed';
    return internalApiError(msg, 502, correlationId);
  }

  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'x-correlation-id': correlationId,
    'x-geocode-ms': String(result.durationMs),
    'x-geocode-outcome': result.outcome,
  };
  if (result.outcome === 'stale_fallback') {
    headers['x-geocode-stale'] = '1';
  }

  return NextResponse.json(result.data, { headers });
}
