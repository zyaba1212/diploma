import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logApiMetric } from '@/lib/apiOps';
import { internalApiError } from '@/lib/apiError';

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const response = NextResponse.json(
      {
        ok: true,
        app: 'ok',
        db: 'ok',
      },
      { headers: { 'cache-control': 'no-store' } },
    );
    logApiMetric({
      route: '/api/health',
      method: 'GET',
      status: 200,
      durationMs: Date.now() - started,
      ok: true,
    });
    return response;
  } catch {
    logApiMetric({
      route: '/api/health',
      method: 'GET',
      status: 503,
      durationMs: Date.now() - started,
      ok: false,
      note: 'db_unreachable',
    });
    return internalApiError('health check failed', 503);
  }
}

