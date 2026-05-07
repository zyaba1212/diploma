/**
 * Общая авторизация для cron-роутов (Vercel Cron + ручной вызов с секретом).
 */
export function isCronAuthorized(req: Request): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 8) return false;
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '').trim();
  const url = new URL(req.url);
  const qSecret = url.searchParams.get('secret');
  return token === secret || qSecret === secret;
}

export function cronUnauthorizedResponse(): Response {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 8) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}
