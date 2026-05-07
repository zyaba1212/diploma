import { NextResponse } from 'next/server';
import { createCorrelationId, internalApiError } from '@/lib/apiError';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import {
  getCachedGeocode,
  setCachedGeocode,
  tryGetGeocodeFromRedis,
} from '@/lib/geocodeCache';
import { GEOCODE_MEMORY_TTL_NEARBY_MS } from '@/lib/geocode/constants';
import { runNominatimJson } from '@/lib/geocode/nominatimUpstream';
import { logGeocodeServerEvent } from '@/lib/geocode/observability';

export const maxDuration = 60;

type NearbyLabel = {
  lat: string;
  lon: string;
  display_name?: string;
  type?: string;
};

export async function GET(req: Request) {
  const correlationId = createCorrelationId();
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`geocode.nearby:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const radiusKm = Number(url.searchParams.get('radiusKm'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'invalid lat/lng' }, { status: 400 });
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'lat/lng out of range' }, { status: 400 });
  }

  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    return NextResponse.json({ error: 'invalid radiusKm' }, { status: 400 });
  }

  if (radiusKm > 200) {
    return NextResponse.json({ error: 'radiusKm too large' }, { status: 400 });
  }

  const cacheKey = `geocode:nearby:lat:${lat}:lng:${lng}:r:${radiusKm}`;
  const mem = getCachedGeocode<NearbyLabel[]>(cacheKey);
  if (mem) {
    logGeocodeServerEvent({
      route: 'nearby',
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

  const redisHit = await tryGetGeocodeFromRedis<NearbyLabel[]>(cacheKey);
  if (redisHit) {
    setCachedGeocode(cacheKey, redisHit, GEOCODE_MEMORY_TTL_NEARBY_MS);
    logGeocodeServerEvent({
      route: 'nearby',
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

  const result = await runNominatimJson<NearbyLabel[]>({
    routeLabel: 'nearby',
    circuitKey: 'geocode:nearby',
    cacheKey,
    upstreamUrl: upstream,
    ttlMs: GEOCODE_MEMORY_TTL_NEARBY_MS,
    correlationId,
    transform: (raw: unknown) => {
      const data = raw as Record<string, unknown>;
      const label: NearbyLabel = {
        lat: String(data?.lat ?? String(lat)),
        lon: String(data?.lon ?? String(lng)),
        display_name: typeof data?.display_name === 'string' ? data.display_name : undefined,
        type: typeof data?.type === 'string' ? data.type : undefined,
      };
      return [label];
    },
  });

  if (!result.ok) {
    const msg =
      result.message === 'upstream error'
        ? 'nearby geocode failed'
        : result.message === 'geocode temporarily unavailable'
          ? 'geocode temporarily unavailable'
          : 'nearby geocode failed';
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
