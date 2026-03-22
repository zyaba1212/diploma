import { NextResponse } from 'next/server';
import { syncNewsFeedsFromRss } from '@/lib/news/syncFeeds';

/** Запрос от Vercel Cron (заголовок нельзя подделать снаружи инфраструктуры Vercel). */
function isVercelCronRequest(req: Request): boolean {
  return req.headers.get('x-vercel-cron') === '1';
}

function authorize(req: Request, url: URL): boolean {
  if (isVercelCronRequest(req)) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (bearer === secret) return true;
  const q = url.searchParams.get('secret');
  if (q === secret) return true;
  return false;
}

/** Локальный/ручной вызов с секретом; Vercel Cron обходит через x-vercel-cron. */
function secretConfigured(): boolean {
  const s = process.env.CRON_SECRET;
  return Boolean(s && s.length >= 8);
}

/**
 * Фоновая синхронизация RSS → NewsCache. Не вызывать из публичного UI.
 *
 * POST с заголовком `Authorization: Bearer <CRON_SECRET>`
 * или GET/POST с `?secret=<CRON_SECRET>` (query — слабее, только для совместимости с простыми cron).
 * На Vercel расписание из `vercel.json` бьёт GET с заголовком `x-vercel-cron: 1` (секрет не нужен).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!isVercelCronRequest(req) && !secretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!authorize(req, url)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await syncNewsFeedsFromRss();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'sync failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isVercelCronRequest(req) && !secretConfigured()) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!authorize(req, url)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await syncNewsFeedsFromRss();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'sync failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
