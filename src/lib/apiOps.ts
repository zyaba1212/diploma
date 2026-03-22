type ApiMetric = {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  ok: boolean;
  note?: string;
};

export function logApiMetric(metric: ApiMetric) {
  // Structured log line for lightweight observability (no external metrics system required).
  console.info(
    JSON.stringify({
      type: 'api_metric',
      ts: new Date().toISOString(),
      ...metric,
    }),
  );
}

