import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { fetchAndCacheNews } from '@/lib/news';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  await fetchAndCacheNews();

  const items = await prisma.newsCache.findMany({
    orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
    take: limit,
    skip: offset,
    select: { id: true, title: true, description: true, url: true, source: true, publishedAt: true },
  });

  return NextResponse.json(items, { headers: { 'cache-control': 'public, max-age=300' } });
}
