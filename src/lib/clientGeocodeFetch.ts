import { GEOCODE_CLIENT_FETCH_TIMEOUT_MS } from '@/lib/geocode/constants';

/** Клиентский дедлайн `fetchGeocodeJson` (не путать с отменой родительским signal). */
export class GeocodeClientDeadlineError extends Error {
  constructor() {
    super('geocode client deadline');
    this.name = 'GeocodeClientDeadlineError';
  }
}

/** Отмена более новым запросом / cleanup эффекта — не показывать как «таймаут». */
export class GeocodeClientSupersededError extends Error {
  constructor() {
    super('geocode superseded');
    this.name = 'GeocodeClientSupersededError';
  }
}

/** Ответ `/api/geocode/*` с ошибкой и опциональным `code` из JSON. */
export class GeocodeHttpError extends Error {
  readonly httpStatus: number;
  readonly code?: string;
  constructor(httpStatus: number, message: string, code?: string) {
    super(message);
    this.name = 'GeocodeHttpError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/**
 * Fetch JSON from `/api/geocode/*` with:
 * - combined deadline (client SLA)
 * - external abort (single-flight / superseded requests)
 */
export async function fetchGeocodeJson<T>(
  url: string,
  opts: {
    /** Abort when user navigates away or a newer geocode supersedes this one */
    signal: AbortSignal;
    deadlineMs?: number;
  },
): Promise<T> {
  const deadlineMs = opts.deadlineMs ?? GEOCODE_CLIENT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let deadlineHit = false;
  let tid: ReturnType<typeof globalThis.setTimeout> | undefined;
  if (typeof window !== 'undefined') {
    tid = globalThis.setTimeout(() => {
      deadlineHit = true;
      controller.abort();
    }, deadlineMs);
  }

  const onParentAbort = () => controller.abort();
  opts.signal.addEventListener('abort', onParentAbort);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      let code: string | undefined;
      const json = (await res.json().catch(() => null)) as
        | { error?: string; code?: string; correlationId?: string }
        | null;
      if (json?.error) msg = json.error;
      if (typeof json?.code === 'string') code = json.code;
      throw new GeocodeHttpError(res.status, msg, code);
    }
    return (await res.json()) as T;
  } catch (e: unknown) {
    if (isAbortError(e)) {
      if (opts.signal.aborted) {
        throw new GeocodeClientSupersededError();
      }
      if (deadlineHit) {
        throw new GeocodeClientDeadlineError();
      }
      throw new GeocodeClientSupersededError();
    }
    throw e;
  } finally {
    if (tid !== undefined) globalThis.clearTimeout(tid);
    opts.signal.removeEventListener('abort', onParentAbort);
  }
}

function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  return (e as Error).name === 'AbortError';
}

/** Russian UX copy for geocode failures (never expose raw `signal is aborted without reason`). */
export function formatGeocodeClientError(e: unknown): string {
  if (e instanceof GeocodeClientSupersededError) {
    return '';
  }
  if (e instanceof GeocodeClientDeadlineError) {
    return 'Превышено время ожидания геокодера. Попробуйте ещё раз.';
  }
  if (e instanceof GeocodeHttpError) {
    if (e.httpStatus === 429) return 'Слишком много запросов к геокодеру. Подождите минуту.';
    if (e.code === 'geocode_upstream_timeout') {
      return 'Превышено время ожидания ответа геокодера. Попробуйте ещё раз.';
    }
    if (e.code === 'geocode_circuit_open') {
      return 'Сервис геокодирования временно недоступен. Попробуйте позже.';
    }
    if (e.httpStatus >= 500 || e.code?.startsWith('geocode_')) {
      return 'Сервис геокодирования временно недоступен. Попробуйте позже.';
    }
    return e.message;
  }
  if (isAbortError(e)) {
    return 'Превышено время ожидания геокодера. Попробуйте ещё раз.';
  }
  if (e instanceof Error) {
    const m = e.message;
    if (m.startsWith('HTTP 429')) return 'Слишком много запросов к геокодеру. Подождите минуту.';
    if (m.startsWith('HTTP 5') || m.includes('geocode')) {
      return 'Сервис геокодирования временно недоступен. Попробуйте позже.';
    }
    return m;
  }
  return 'Не удалось выполнить геокодирование.';
}
