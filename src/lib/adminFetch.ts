export function formatHttpError(status: number, fallback?: string): string {
  if (status === 401) return 'Требуется авторизация (401). Пожалуйста, войдите в админ-панель заново.';
  if (status === 403) return 'Недостаточно прав для этого действия (403).';
  if (status === 404) return 'Не найдено (404).';
  if (status === 409) return fallback || 'Конфликт состояния (409).';
  if (status === 429) return 'Слишком много запросов. Попробуйте позже (429).';
  if (status >= 500) return 'Ошибка сервера. Попробуйте позже.';
  if (status >= 400) return fallback || 'Некорректный запрос.';
  return fallback || `HTTP ${status}`;
}

export async function readErrorMessage(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (json?.error) return formatHttpError(res.status, json.error);
  return formatHttpError(res.status);
}

export class AdminApiError extends Error {
  status: number;
  unauthorized: boolean;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.unauthorized = status === 401;
  }
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  opts: RequestInit | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(opts?.headers || {}),
      },
    });
    if (!res.ok) throw new AdminApiError(await readErrorMessage(res), res.status);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(t);
  }
}

export function adminJson<TBody extends object>(body: TBody): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function adminPatch<TBody extends object>(body: TBody): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function adminDelete(): RequestInit {
  return { method: 'DELETE' };
}

export function adminDeleteJson<TBody extends object>(body: TBody): RequestInit {
  return {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
