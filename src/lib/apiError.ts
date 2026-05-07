import { NextResponse } from 'next/server';

export function createCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function internalApiError(
  message = 'internal error',
  status = 500,
  correlationId?: string,
  /** Стабильный машинный код для клиента (например geocode proxy). */
  code?: string,
) {
  const cid = correlationId ?? createCorrelationId();
  const body: { error: string; correlationId: string; code?: string } = {
    error: message,
    correlationId: cid,
  };
  if (code) body.code = code;

  const headers: Record<string, string> = {
    'x-correlation-id': cid,
    'cache-control': 'no-store',
  };
  if (code) headers['x-geocode-code'] = code;

  return NextResponse.json(body, {
    status,
    headers,
  });
}

