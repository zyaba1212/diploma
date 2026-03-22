import { NextResponse } from 'next/server';

function getContentLength(req: Request): number | null {
  const raw = req.headers.get('content-length');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function assertBodySizeWithin(req: Request, maxBytes: number) {
  const len = getContentLength(req);
  if (len !== null && len > maxBytes) {
    return NextResponse.json({ error: 'payload too large' }, { status: 400 });
  }
  return null;
}

