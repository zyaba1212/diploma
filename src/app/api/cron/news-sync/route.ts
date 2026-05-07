import { NextResponse } from 'next/server';

import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cronAuth';
import { fetchAndCacheNews } from '@/lib/news';

async function runSync() {
  const { fetched } = await fetchAndCacheNews({ force: true });
  return NextResponse.json({ ok: true, fetched });
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return cronUnauthorizedResponse();
  }
  return runSync();
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return cronUnauthorizedResponse();
  }
  return runSync();
}
