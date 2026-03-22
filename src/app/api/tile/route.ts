import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { circuitFetch } from '@/lib/circuitBreaker';
import { internalApiError } from '@/lib/apiError';
import { getCachedTile, setCachedTile } from '@/lib/tileCache';

const SOURCES: Record<string, string> = {
  esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};

const TILE_WINDOW_MS = 60_000;
function tileRateLimitMax(): number {
  const raw = process.env.TILE_RATE_LIMIT_MAX;
  if (raw === undefined || raw === '') return 4000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

function tileFetchHeaders(): HeadersInit {
  return {
    'user-agent': 'diploma-z96a/1.0',
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const z = url.searchParams.get('z');
  const x = url.searchParams.get('x');
  const y = url.searchParams.get('y');

  const sourceParam = url.searchParams.get('source');
  const source = (sourceParam || 'esri').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SOURCES, source)) {
    return NextResponse.json({ error: 'invalid source' }, { status: 400 });
  }

  if (!z || !x || !y) return NextResponse.json({ error: 'missing z/x/y' }, { status: 400 });
  if (![z, x, y].every((v) => /^\d+$/.test(v))) return NextResponse.json({ error: 'invalid z/x/y' }, { status: 400 });

  const cacheKey = `${source}:${z}:${x}:${y}`;
  const cached = getCachedTile(cacheKey);
  if (cached) {
    return new NextResponse(cached.buf, {
      status: 200,
      headers: {
        'content-type': cached.contentType,
        'cache-control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`tile:${clientIp}`, tileRateLimitMax(), TILE_WINDOW_MS))) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const template = SOURCES[source];
  const tileUrl = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const respondOk = (buf: ArrayBuffer, contentType: string) => {
    setCachedTile(cacheKey, buf, contentType);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  };

  try {
    const r = await circuitFetch(`tile:${source}`, () =>
      fetch(tileUrl, {
        signal: controller.signal,
        headers: tileFetchHeaders(),
        cache: 'force-cache',
        next: { revalidate: 60 * 60 * 24 },
      }),
    );
    if (!r.ok) return internalApiError('upstream error', 502);
    const buf = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'image/png';
    return respondOk(buf, ct);
  } catch {
    if (source !== 'osm') {
      const osmUrl = SOURCES.osm.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      try {
        const r2 = await circuitFetch(`tile:osm`, () =>
          fetch(osmUrl, {
            headers: tileFetchHeaders(),
            cache: 'force-cache',
            next: { revalidate: 60 * 60 * 24 },
          }),
        );
        if (!r2.ok) return internalApiError('upstream error', 502);
        const buf2 = await r2.arrayBuffer();
        const ct2 = r2.headers.get('content-type') || 'image/png';
        return respondOk(buf2, ct2);
      } catch {
        return internalApiError('tile fetch failed', 502);
      }
    }
    return internalApiError('tile fetch failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}
