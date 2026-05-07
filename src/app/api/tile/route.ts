import { NextResponse } from 'next/server';
import { CircuitOpenError, circuitFetch } from '@/lib/circuitBreaker';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { internalApiError } from '@/lib/apiError';
import { logTileServerEvent } from '@/lib/tile/observability';
import { TILE_CIRCUIT_OPTS } from '@/lib/tile/tileConstants';

const SOURCES: Record<string, string> = {
  esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};

const TILE_RL_MAX = Math.max(100, Number(process.env.TILE_RATE_LIMIT_MAX ?? '4000'));
const TILE_RL_WINDOW_MS = Math.max(1000, Number(process.env.TILE_RATE_LIMIT_WINDOW_MS ?? '60000'));

function correlationIdFrom(req: Request): string {
  return (
    req.headers.get('x-correlation-id')?.trim() ||
    req.headers.get('x-request-id')?.trim() ||
    crypto.randomUUID()
  );
}

async function fetchTileUpstream(
  circuitKey: string,
  tileUrl: string,
  signal: AbortSignal,
  correlationId: string,
  source: string,
): Promise<Response> {
  const t0 = Date.now();
  try {
    const r = await circuitFetch(
      circuitKey,
      () =>
        fetch(tileUrl, {
          signal,
          headers: {
            'user-agent': 'diploma-z96a/1.0',
            accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          cache: 'force-cache',
          next: { revalidate: 60 * 60 * 24 },
        }),
      TILE_CIRCUIT_OPTS,
    );
    const durationMs = Date.now() - t0;
    if (!r.ok) {
      logTileServerEvent({
        route: 'tile',
        durationMs,
        outcome: 'upstream_http_error',
        source,
        upstreamStatus: r.status,
        correlationId,
      });
    } else {
      logTileServerEvent({
        route: 'tile',
        durationMs,
        outcome: 'success',
        source,
        correlationId,
      });
    }
    return r;
  } catch (e) {
    const durationMs = Date.now() - t0;
    if (e instanceof CircuitOpenError) {
      logTileServerEvent({
        route: 'tile',
        durationMs,
        outcome: 'circuit_open',
        source,
        correlationId,
      });
    } else if (e instanceof Error && e.name === 'AbortError') {
      logTileServerEvent({
        route: 'tile',
        durationMs,
        outcome: 'upstream_timeout',
        source,
        correlationId,
      });
    } else {
      logTileServerEvent({
        route: 'tile',
        durationMs,
        outcome: 'fetch_error',
        source,
        detail: e instanceof Error ? e.message : String(e),
        correlationId,
      });
    }
    throw e;
  }
}

export async function GET(req: Request) {
  const correlationId = correlationIdFrom(req);
  const url = new URL(req.url);
  const z = url.searchParams.get('z');
  const x = url.searchParams.get('x');
  const y = url.searchParams.get('y');
  const clientIp = getClientIp(req);

  if (!(await checkRateLimit(`tile:${clientIp}`, TILE_RL_MAX, TILE_RL_WINDOW_MS))) {
    logTileServerEvent({
      route: 'tile',
      durationMs: 0,
      outcome: 'rate_limited',
      detail: `max=${TILE_RL_MAX},windowMs=${TILE_RL_WINDOW_MS}`,
      correlationId,
    });
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
    const r = await fetchTileUpstream(`tile:${source}`, tileUrl, controller.signal, correlationId, source);
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
      const fbController = new AbortController();
      const fbTimeout = setTimeout(() => fbController.abort(), 10_000);
      try {
        logTileServerEvent({
          route: 'tile',
          durationMs: 0,
          outcome: 'fallback_osm',
          source: 'osm',
          detail: `from=${source}`,
          correlationId,
        });
        const r2 = await fetchTileUpstream(
          `tile:osm`,
          osmUrl,
          fbController.signal,
          correlationId,
          'osm',
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
      } finally {
        clearTimeout(fbTimeout);
      }
    }
    return internalApiError('tile fetch failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}
