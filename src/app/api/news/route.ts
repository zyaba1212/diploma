import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { fetchAndCacheNews } from '@/lib/news';
import { newsListOrderBy, resolveNewsWindowDays } from '@/lib/newsQuery';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const legacy = url.searchParams.get('legacy') === '1';

  if (legacy) {
    const limit = Math.min(Number(url.searchParams.get('limit')) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

    await fetchAndCacheNews();

    const items = await prisma.newsCache.findMany({
      orderBy: newsListOrderBy,
      take: limit,
      skip: offset,
      select: { id: true, title: true, description: true, url: true, source: true, publishedAt: true },
    });

    return NextResponse.json(items, { headers: { 'cache-control': 'public, max-age=300' } });
  }

  const page = Math.max(Math.floor(Number(url.searchParams.get('page')) || 1), 1);
  const pageSize = Math.min(
    Math.max(Math.floor(Number(url.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const offset = (page - 1) * pageSize;
  const initialDays = Math.max(1, Math.min(Number(url.searchParams.get('days')) || 3, 3650));

  await fetchAndCacheNews();

  const { where, days: windowDays } = await resolveNewsWindowDays({
    prisma,
    offset,
    pageSize,
    initialDays,
  });

  const [total, items] = await Promise.all([
    prisma.newsCache.count({ where }),
    prisma.newsCache.findMany({
      where,
      orderBy: newsListOrderBy,
      take: pageSize,
      skip: offset,
      select: { id: true, title: true, description: true, url: true, source: true, publishedAt: true },
    }),
  ]);

  const hasMore = offset + items.length < total;

  return NextResponse.json(
    {
      items,
      total,
      page,
      pageSize,
      hasMore,
      windowDays,
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
