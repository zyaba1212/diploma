/**
 * Geocode SLA budget (client ↔ Next route ↔ Nominatim).
 * Rule: GEOCODE_CLIENT_FETCH_TIMEOUT_MS >= GEOCODE_UPSTREAM_TIMEOUT_MS + margin for cold starts + JSON parse.
 */
export const GEOCODE_UPSTREAM_TIMEOUT_MS = 10_000;
/** Browser fetch to our `/api/geocode/*` — must exceed server upstream + handler overhead. */
export const GEOCODE_CLIENT_FETCH_TIMEOUT_MS = 18_000;

export const GEOCODE_MEMORY_TTL_SEARCH_MS = 5 * 60_000;
export const GEOCODE_MEMORY_TTL_REVERSE_MS = 30 * 60_000;
export const GEOCODE_MEMORY_TTL_NEARBY_MS = 5 * 60_000;

/** Stale-if-error backup TTL (Redis + in-memory). */
export const GEOCODE_STALE_BACKUP_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Circuit breaker tuned for flaky public upstream (fewer false “open” periods than defaults).
 * Defaults in circuitBreaker: threshold 5 / window 60s / cooldown 30s.
 */
export const GEOCODE_CIRCUIT_OPTS = {
  failureThreshold: 12,
  windowMs: 120_000,
  cooldownMs: 20_000,
} as const;
