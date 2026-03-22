import { NextResponse } from 'next/server';

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function internalApiError(message = 'internal error', status = 500) {
  const correlationId = createCorrelationId();
  return NextResponse.json(
    { error: message, correlationId },
    {
      status,
      headers: {
        'x-correlation-id': correlationId,
        'cache-control': 'no-store',
      },
    },
  );
}

