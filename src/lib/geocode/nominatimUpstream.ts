import { circuitFetch, CircuitOpenError } from '@/lib/circuitBreaker';
import {
  GEOCODE_CIRCUIT_OPTS,
  GEOCODE_UPSTREAM_TIMEOUT_MS,
} from '@/lib/geocode/constants';
import {
  getStaleGeocodeBackup,
  setCachedGeocode,
  setStaleGeocodeBackup,
} from '@/lib/geocodeCache';
import { logGeocodeServerEvent, type GeocodeServerOutcome } from '@/lib/geocode/observability';
import { coalesceGeocodeInflight } from '@/lib/geocode/inflightCoalesce';

export type NominatimRouteLabel = 'search' | 'reverse' | 'nearby';

export type NominatimOk<T> = {
  ok: true;
  data: T;
  durationMs: number;
  outcome: 'upstream_success' | 'stale_fallback';
};

export type NominatimFail = {
  ok: false;
  message: string;
  durationMs: number;
  outcome: GeocodeServerOutcome;
};

function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  return (e as Error).name === 'AbortError';
}

async function recoverStale<T>(cacheKey: string): Promise<T | null> {
  return getStaleGeocodeBackup<T>(cacheKey);
}

export async function runNominatimJson<T>(params: {
  routeLabel: NominatimRouteLabel;
  circuitKey: string;
  cacheKey: string;
  upstreamUrl: URL;
  ttlMs: number;
  correlationId?: string;
  transform?: (raw: unknown) => T;
}): Promise<NominatimOk<T> | NominatimFail> {
  return coalesceGeocodeInflight(params.cacheKey, async () => {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, GEOCODE_UPSTREAM_TIMEOUT_MS);

    try {
      let r: Response;
      try {
        r = await circuitFetch(
          params.circuitKey,
          () =>
            fetch(params.upstreamUrl, {
              signal: controller.signal,
              headers: {
                'user-agent': 'diploma-z96a/1.0',
                accept: 'application/json',
              },
              cache: 'no-store',
            }),
          GEOCODE_CIRCUIT_OPTS,
        );
      } catch (e: unknown) {
        const durationMs = Date.now() - started;

        if (e instanceof CircuitOpenError) {
          logGeocodeServerEvent({
            route: params.routeLabel,
            durationMs,
            outcome: 'circuit_open',
            detail: e.key,
            correlationId: params.correlationId,
          });
          const stale = await recoverStale<T>(params.cacheKey);
          if (stale) {
            logGeocodeServerEvent({
              route: params.routeLabel,
              durationMs,
              outcome: 'stale_fallback',
              detail: 'circuit_open',
              correlationId: params.correlationId,
            });
            return { ok: true, data: stale, durationMs, outcome: 'stale_fallback' };
          }
          return {
            ok: false,
            message: 'geocode temporarily unavailable',
            durationMs,
            outcome: 'circuit_open',
          };
        }

        const aborted = isAbortError(e);
        logGeocodeServerEvent({
          route: params.routeLabel,
          durationMs,
          outcome: aborted ? 'upstream_timeout' : 'fetch_error',
          detail: e instanceof Error ? e.message : String(e),
          correlationId: params.correlationId,
        });

        const stale = await recoverStale<T>(params.cacheKey);
        if (stale) {
          logGeocodeServerEvent({
            route: params.routeLabel,
            durationMs,
            outcome: 'stale_fallback',
            detail: aborted ? 'upstream_timeout' : 'fetch_error',
            correlationId: params.correlationId,
          });
          return { ok: true, data: stale, durationMs, outcome: 'stale_fallback' };
        }

        return {
          ok: false,
          message: aborted ? 'geocode upstream timeout' : 'geocode failed',
          durationMs,
          outcome: aborted ? 'upstream_timeout' : 'fetch_error',
        };
      }

      const durationMs = Date.now() - started;

      if (!r.ok) {
        logGeocodeServerEvent({
          route: params.routeLabel,
          durationMs,
          outcome: 'upstream_http_error',
          upstreamStatus: r.status,
          correlationId: params.correlationId,
        });
        const stale = await recoverStale<T>(params.cacheKey);
        if (stale) {
          logGeocodeServerEvent({
            route: params.routeLabel,
            durationMs,
            outcome: 'stale_fallback',
            detail: `http_${r.status}`,
            correlationId: params.correlationId,
          });
          return { ok: true, data: stale, durationMs, outcome: 'stale_fallback' };
        }
        return {
          ok: false,
          message: 'upstream error',
          durationMs,
          outcome: 'upstream_http_error',
        };
      }

      let raw: unknown;
      try {
        raw = await r.json();
      } catch (e: unknown) {
        const parseMs = Date.now() - started;
        logGeocodeServerEvent({
          route: params.routeLabel,
          durationMs: parseMs,
          outcome: 'parse_error',
          detail: e instanceof Error ? e.message : String(e),
          correlationId: params.correlationId,
        });
        const stale = await recoverStale<T>(params.cacheKey);
        if (stale) {
          return { ok: true, data: stale, durationMs: parseMs, outcome: 'stale_fallback' };
        }
        return {
          ok: false,
          message: 'geocode parse failed',
          durationMs: parseMs,
          outcome: 'parse_error',
        };
      }

      const data = params.transform ? params.transform(raw) : (raw as T);

      setCachedGeocode(params.cacheKey, data, params.ttlMs);
      setStaleGeocodeBackup(params.cacheKey, data);

      logGeocodeServerEvent({
        route: params.routeLabel,
        durationMs,
        outcome: 'upstream_success',
        correlationId: params.correlationId,
      });

      return { ok: true, data, durationMs, outcome: 'upstream_success' };
    } finally {
      clearTimeout(timeout);
    }
  });
}
