import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { circuitFetch } from '@/lib/circuitBreaker';
import { internalApiError } from '@/lib/apiError';
import { getCachedGeocode, setCachedGeocode } from '@/lib/geocodeCache';

type NearbyLabel = {
  lat: string;
  lon: string;
  display_name?: string;
  type?: string;
};

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`geocode.nearby:${clientIp}`, 30, 60_000))) {
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

  // Prevent unreasonable fan-out / cache explosion.
  if (radiusKm > 200) {
    return NextResponse.json({ error: 'radiusKm too large' }, { status: 400 });
  }

  // Currently we return a minimal "nearby labels" list using reverse geocoding for the center.
  // `radiusKm` is part of the cache key to preserve caller intent.
  const cacheKey = `geocode:nearby:lat:${lat}:lng:${lng}:r:${radiusKm}`;
  const cached = getCachedGeocode<NearbyLabel[]>(cacheKey);
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
    const r = await circuitFetch(`geocode:nearby`, () =>
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

    const data = (await r.json()) as any;
    const label: NearbyLabel = {
      lat: String(data?.lat ?? String(lat)),
      lon: String(data?.lon ?? String(lng)),
      display_name: typeof data?.display_name === 'string' ? data.display_name : undefined,
      type: typeof data?.type === 'string' ? data.type : undefined,
    };

    const labels = [label];
    setCachedGeocode(cacheKey, labels);
    return NextResponse.json(labels, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return internalApiError('nearby geocode failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}

