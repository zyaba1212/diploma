import { NextResponse } from 'next/server';
import { createCorrelationId, internalApiError } from '@/lib/apiError';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import {
  getCachedGeocode,
  setCachedGeocode,
  tryGetGeocodeFromRedis,
} from '@/lib/geocodeCache';
import { GEOCODE_MEMORY_TTL_REVERSE_MS } from '@/lib/geocode/constants';
import { runNominatimJson } from '@/lib/geocode/nominatimUpstream';
import { logGeocodeServerEvent, type GeocodeServerOutcome } from '@/lib/geocode/observability';

function reverseFailurePublicMessage(
  outcome: GeocodeServerOutcome,
  upstreamMessage: string,
): string {
  if (upstreamMessage === 'geocode temporarily unavailable') {
    return 'geocode temporarily unavailable';
  }
  switch (outcome) {
    case 'upstream_timeout':
      return 'reverse geocode upstream timeout';
    case 'circuit_open':
      return 'geocode temporarily unavailable';
    case 'upstream_http_error':
    case 'fetch_error':
    case 'parse_error':
      return 'reverse geocode failed';
    default:
      return 'reverse geocode failed';
  }
}

function reverseFailureCode(outcome: GeocodeServerOutcome): string {
  switch (outcome) {
    case 'upstream_timeout':
      return 'geocode_upstream_timeout';
    case 'circuit_open':
      return 'geocode_circuit_open';
    case 'upstream_http_error':
      return 'geocode_upstream_http_error';
    case 'fetch_error':
      return 'geocode_fetch_error';
    case 'parse_error':
      return 'geocode_parse_error';
    default:
      return 'geocode_reverse_failed';
  }
}

export const maxDuration = 60;

export async function GET(req: Request) {
  const correlationId = createCorrelationId();
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`geocode.reverse:${clientIp}`, 90, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'invalid lat/lng' }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'lat/lng out of range' }, { status: 400 });
  }

  const cacheKey = `geocode:reverse:lat:${lat}:lng:${lng}`;
  const mem = getCachedGeocode<unknown>(cacheKey);
  if (mem) {
    logGeocodeServerEvent({
      route: 'reverse',
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
    setCachedGeocode(cacheKey, redisHit, GEOCODE_MEMORY_TTL_REVERSE_MS);
    logGeocodeServerEvent({
      route: 'reverse',
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

  const upstream = new URL('https://nominatim.openstreetmap.org/reverse');
  upstream.searchParams.set('lat', String(lat));
  upstream.searchParams.set('lon', String(lng));
  upstream.searchParams.set('format', 'json');

  const result = await runNominatimJson<unknown>({
    routeLabel: 'reverse',
    circuitKey: 'geocode:reverse',
    cacheKey,
    upstreamUrl: upstream,
    ttlMs: GEOCODE_MEMORY_TTL_REVERSE_MS,
    correlationId,
  });

  if (!result.ok) {
    const msg = reverseFailurePublicMessage(result.outcome, result.message);
    const code = reverseFailureCode(result.outcome);
    return internalApiError(msg, 502, correlationId, code);
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
