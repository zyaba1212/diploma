export type TileServerOutcome =
  | 'success'
  | 'upstream_http_error'
  | 'upstream_timeout'
  | 'circuit_open'
  | 'fetch_error'
  | 'fallback_osm'
  | 'rate_limited';

/**
 * По умолчанию в stdout попадают только ошибки / rate-limit / circuit (меньше шума под pan).
 * Полный лог каждого успешного тайла: `TILE_DEBUG_LOG=1` или `verbose`.
 * Полное отключение: `TILE_DEBUG_LOG=0`.
 */
export function logTileServerEvent(entry: {
  route: 'tile';
  durationMs: number;
  outcome: TileServerOutcome;
  source?: string;
  detail?: string;
  upstreamStatus?: number;
  correlationId?: string;
}): void {
  if (process.env.TILE_DEBUG_LOG === '0') return;
  const verbose =
    process.env.TILE_DEBUG_LOG === '1' ||
    process.env.TILE_DEBUG_LOG === 'verbose';
  if (entry.outcome === 'success' && !verbose) return;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: 'tile',
      ...entry,
    }),
  );
}
