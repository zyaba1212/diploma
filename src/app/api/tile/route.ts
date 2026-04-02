import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { circuitFetch } from '@/lib/circuitBreaker';
import { internalApiError } from '@/lib/apiError';

const SOURCES: Record<string, string> = {
  esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const z = url.searchParams.get('z');
  const x = url.searchParams.get('x');
  const y = url.searchParams.get('y');
  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`tile:${clientIp}`, 300, 60_000))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const sourceParam = url.searchParams.get('source');
  const source = (sourceParam || 'esri').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SOURCES, source)) {
    return NextResponse.json({ error: 'invalid source' }, { status: 400 });
  }

  if (!z || !x || !y) return NextResponse.json({ error: 'missing z/x/y' }, { status: 400 });
  if (![z, x, y].every((v) => /^\d+$/.test(v))) return NextResponse.json({ error: 'invalid z/x/y' }, { status: 400 });

  const template = SOURCES[source];
  const tileUrl = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const r = await circuitFetch(`tile:${source}`, () =>
      fetch(tileUrl, {
        signal: controller.signal,
        headers: {
          'user-agent': 'diploma-z96a/1.0',
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        cache: 'force-cache',
        next: { revalidate: 60 * 60 * 24 },
      }),
    );
    if (!r.ok) return internalApiError('upstream error', 502);
    const buf = await r.arrayBuffer();

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': r.headers.get('content-type') || 'image/png',
        'cache-control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch {
    // fallback to OSM if ESRI fails
    if (source !== 'osm') {
      const osmUrl = SOURCES.osm.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      try {
        const r2 = await circuitFetch(`tile:osm`, () =>
          fetch(osmUrl, { cache: 'force-cache', next: { revalidate: 60 * 60 * 24 } }),
        );
        if (!r2.ok) return internalApiError('upstream error', 502);
        const buf2 = await r2.arrayBuffer();
        return new NextResponse(buf2, {
          status: 200,
          headers: {
            'content-type': r2.headers.get('content-type') || 'image/png',
            'cache-control': 'public, max-age=86400, s-maxage=86400',
          },
        });
      } catch {
        return internalApiError('tile fetch failed', 502);
      }
    }
    return internalApiError('tile fetch failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}

