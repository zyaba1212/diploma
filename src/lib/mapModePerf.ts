/**
 * Client-side helpers for map-mode benchmarking (see docs/map-mode-benchmark.md).
 */
export function mapPerfDebugEnabled(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_MAP_PERF_DEBUG === '1'
  );
}

export function logMapPerf(event: string, detail: Record<string, unknown>): void {
  if (!mapPerfDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info('[map-perf]', JSON.stringify({ ts: Date.now(), event, ...detail }));
}
