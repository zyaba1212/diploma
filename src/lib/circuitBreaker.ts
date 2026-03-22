type CircuitState = {
  failures: number;
  windowStart: number;
  openUntil: number; // epoch ms
};

const globalAny = globalThis as unknown as {
  __diplomaCircuits?: Map<string, CircuitState>;
};

function getCircuits(): Map<string, CircuitState> {
  if (!globalAny.__diplomaCircuits) globalAny.__diplomaCircuits = new Map();
  return globalAny.__diplomaCircuits;
}

export class CircuitOpenError extends Error {
  key: string;
  constructor(key: string) {
    super(`circuit_open:${key}`);
    this.key = key;
  }
}

type CircuitOpts = {
  failureThreshold?: number;
  windowMs?: number;
  cooldownMs?: number;
  /**
   * Не увеличивать счётчик ошибок цепи для этих HTTP-статусов (например 429 от Nominatim —
   * клиенту всё равно нужно вернуть 429 отдельно в route).
   */
  treatAsNeutral?: number[];
};

function getState(key: string): CircuitState {
  const circuits = getCircuits();
  const existing = circuits.get(key);
  if (existing) return existing;

  const now = Date.now();
  const fresh: CircuitState = { failures: 0, windowStart: now, openUntil: 0 };
  circuits.set(key, fresh);
  return fresh;
}

function isOpen(state: CircuitState) {
  return state.openUntil > Date.now();
}

function resetIfWindowExpired(state: CircuitState, windowMs: number) {
  const now = Date.now();
  if (now - state.windowStart > windowMs) {
    state.failures = 0;
    state.windowStart = now;
  }
}

function recordSuccess(key: string) {
  const state = getState(key);
  state.failures = 0;
  state.windowStart = Date.now();
  state.openUntil = 0;
}

function recordFailure(key: string, windowMs: number, failureThreshold: number, cooldownMs: number) {
  const state = getState(key);
  if (isOpen(state)) return;
  resetIfWindowExpired(state, windowMs);

  state.failures += 1;
  if (state.failures >= failureThreshold) {
    state.openUntil = Date.now() + cooldownMs;
  }
}

/**
 * Wrap fetcher with circuit breaker:
 * - open circuit => throws CircuitOpenError
 * - response.ok => success
 * - response not ok or thrown error => failure
 */
export async function circuitFetch(
  key: string,
  fetcher: () => Promise<Response>,
  opts: CircuitOpts = {},
) {
  const failureThreshold = opts.failureThreshold ?? 5;
  const windowMs = opts.windowMs ?? 60_000;
  const cooldownMs = opts.cooldownMs ?? 30_000;

  const state = getState(key);
  if (isOpen(state)) {
    throw new CircuitOpenError(key);
  }

  try {
    const res = await fetcher();
    if (res.ok) {
      recordSuccess(key);
    } else {
      const neutral = opts.treatAsNeutral?.includes(res.status) ?? false;
      if (!neutral) {
        recordFailure(key, windowMs, failureThreshold, cooldownMs);
      }
    }
    return res;
  } catch (err) {
    recordFailure(key, windowMs, failureThreshold, cooldownMs);
    throw err;
  }
}

