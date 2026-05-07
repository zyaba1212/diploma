/**
 * Structured geocode logs for baseline latency/error breakdown and SRE dashboards (grep JSON lines).
 * Disable noise locally: GEOCODE_DEBUG_LOG=0
 */

export type GeocodeServerOutcome =
  | 'cache_memory_hit'
  | 'cache_redis_hit'
  | 'upstream_success'
  | 'upstream_http_error'
  | 'upstream_timeout'
  | 'circuit_open'
  | 'fetch_error'
  | 'stale_fallback'
  | 'parse_error';

export type GeocodeServerLog = {
  ts: string;
  scope: 'geocode';
  route: string;
  durationMs: number;
  outcome: GeocodeServerOutcome;
  detail?: string;
  upstreamStatus?: number;
  correlationId?: string;
};

export function logGeocodeServerEvent(entry: Omit<GeocodeServerLog, 'ts' | 'scope'>): void {
  if (process.env.GEOCODE_DEBUG_LOG === '0') return;
  const line: GeocodeServerLog = {
    ts: new Date().toISOString(),
    scope: 'geocode',
    ...entry,
  };
  console.log(JSON.stringify(line));
}
