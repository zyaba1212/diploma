import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { circuitFetch } from '@/lib/circuitBreaker';
import { internalApiError } from '@/lib/apiError';
import { getCachedGeocode, setCachedGeocode } from '@/lib/geocodeCache';

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`geocode.reverse:${clientIp}`, 60, 60_000))) {
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
  const cached = getCachedGeocode<unknown>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'cache-control': 'no-store' } });
  }

  const upstream = new URL('https://nominatim.openstreetmap.org/reverse');
  upstream.searchParams.set('lat', String(lat));
  upstream.searchParams.set('lon', String(lng));
  upstream.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const r = await circuitFetch(`geocode:reverse`, () =>
      fetch(upstream, {
        signal: controller.signal,
        headers: {
          'user-agent': 'diploma-z96a/1.0',
          accept: 'application/json',
        },
        cache: 'no-store',
      }),
    );
    if (!r.ok) return internalApiError('upstream error', 502);
    const data = await r.json();
    setCachedGeocode(cacheKey, data);
    return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return internalApiError('reverse geocode failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}

