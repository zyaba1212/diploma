import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { circuitFetch } from '@/lib/circuitBreaker';
import { internalApiError } from '@/lib/apiError';
import { getCachedGeocode, setCachedGeocode } from '@/lib/geocodeCache';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`geocode.search:${clientIp}`, 60, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const trimmed = q?.trim() || '';
  if (trimmed.length < 2) return NextResponse.json({ error: 'q too short' }, { status: 400 });
  if (trimmed.length > 200) return NextResponse.json({ error: 'q too long' }, { status: 400 });

  const cacheKey = `geocode:search:q:${trimmed}`;
  const cached = getCachedGeocode<unknown>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'cache-control': 'no-store' } });
  }

  const upstream = new URL('https://nominatim.openstreetmap.org/search');
  upstream.searchParams.set('q', trimmed);
  upstream.searchParams.set('format', 'json');
  upstream.searchParams.set('limit', '10');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const r = await circuitFetch(`geocode:search`, () =>
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
    return internalApiError('geocode failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}

