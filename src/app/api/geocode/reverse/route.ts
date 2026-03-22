import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { CircuitOpenError, circuitFetch } from '@/lib/circuitBreaker';
import { internalApiError } from '@/lib/apiError';
import { getCachedGeocode, setCachedGeocode } from '@/lib/geocodeCache';
import { normalizeLatLng } from '@/lib/geo/normalizeLatLng';
import { enqueueNominatimFetch } from '@/lib/nominatimQueue';

/** Ключ кэша и координаты для upstream: меньше промахов при мелком движении карты. */
function coarseLatLng(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
  };
}

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`geocode.reverse:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const url = new URL(req.url);
  const rawLat = Number(url.searchParams.get('lat'));
  const rawLng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) {
    return NextResponse.json({ error: 'invalid lat/lng' }, { status: 400 });
  }
  const { lat, lng } = normalizeLatLng(rawLat, rawLng);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'lat/lng out of range' }, { status: 400 });
  }

  const coarse = coarseLatLng(lat, lng);
  const cacheKey = `geocode:reverse:lat:${coarse.lat}:lng:${coarse.lng}`;
  const cached = getCachedGeocode<unknown>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'cache-control': 'no-store' } });
  }

  const upstream = new URL('https://nominatim.openstreetmap.org/reverse');
  upstream.searchParams.set('lat', String(coarse.lat));
  upstream.searchParams.set('lon', String(coarse.lng));
  upstream.searchParams.set('format', 'json');

  try {
    const r = await enqueueNominatimFetch(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        return await circuitFetch(
          `geocode:reverse`,
          () =>
            fetch(upstream, {
              signal: controller.signal,
              headers: {
                'user-agent': 'diploma-z96a/1.0',
                accept: 'application/json',
              },
              cache: 'no-store',
            }),
          { treatAsNeutral: [429], failureThreshold: 12, cooldownMs: 60_000 },
        );
      } finally {
        clearTimeout(timeout);
      }
    });

    if (!r.ok) {
      if (r.status === 429) {
        const retryAfter = r.headers.get('retry-after') || '60';
        return NextResponse.json(
          { error: 'upstream rate limited' },
          {
            status: 429,
            headers: {
              'cache-control': 'no-store',
              'retry-after': retryAfter,
            },
          },
        );
      }
      return internalApiError('upstream error', 502);
    }
    const data = await r.json();
    setCachedGeocode(cacheKey, data);
    return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      return internalApiError('geocode temporarily unavailable', 503);
    }
    return internalApiError('reverse geocode failed', 502);
  }
}
