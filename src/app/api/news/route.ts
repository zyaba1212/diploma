import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const RSS_SOURCES = [
  { name: 'Habr Telecom', url: 'https://habr.com/ru/rss/hub/telecom/all/' },
  { name: 'CNews', url: 'https://www.cnews.ru/inc/rss/news_top.xml' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
  { name: '3DNews', url: 'https://3dnews.ru/news/rss/' },
  { name: 'SecurityLab', url: 'https://www.securitylab.ru/news/rss.php' },
  { name: 'ComNews', url: 'https://www.comnews.ru/rss' },
  { name: 'IXBT', url: 'https://www.ixbt.com/export/news.rss' },
  { name: 'RBC Tech', url: 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
];

const KEYWORDS_RU = ['связь', 'телеком', 'сеть', 'инфраструктура', 'кабель', 'спутник', 'блокчейн', 'офлайн', 'транзакц', '5g', '4g', 'mesh', 'starlink', 'интернет', 'цифров', 'беларус', 'цифровой рубль', 'радиосвязь', 'оптоволокн', 'беспроводн', 'широкополосн'];
const KEYWORDS_EN = ['network', 'telecom', 'satellite', 'blockchain', 'offline', 'mesh', '5g', 'starlink', 'infrastructure', 'cable', 'internet', 'transaction', 'connectivity', 'wireless', 'fiber', 'broadband', 'digital currency', 'decentralized'];
const ALL_KEYWORDS = [...KEYWORDS_RU, ...KEYWORDS_EN];

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
let lastFetchedAt = 0;

function matchesKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return ALL_KEYWORDS.some(kw => lower.includes(kw));
}

type RssItem = { title: string; description: string; link: string; pubDate: string };

function parseRssXml(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s)?.[1]
      ?? block.match(/<title>(.*?)<\/title>/s)?.[1] ?? '';
    const description = block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s)?.[1]
      ?? block.match(/<description>(.*?)<\/description>/s)?.[1] ?? '';
    const link = block.match(/<link>(.*?)<\/link>/s)?.[1] ?? '';
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1] ?? '';
    if (title && link) items.push({ title: title.trim(), description: description.replace(/<[^>]*>/g, '').trim().slice(0, 300), link: link.trim(), pubDate });
  }
  return items;
}

async function fetchAndCacheFeeds() {
  if (Date.now() - lastFetchedAt < CACHE_TTL_MS) return;
  lastFetchedAt = Date.now();

  for (const source of RSS_SOURCES) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssXml(xml);
      const relevant = items.filter(item => matchesKeywords(item.title + ' ' + item.description));

      for (const item of relevant.slice(0, 15)) {
        const publishedAt = item.pubDate ? new Date(item.pubDate) : null;
        await prisma.newsCache.upsert({
          where: { url: item.link },
          create: {
            title: item.title.slice(0, 500),
            description: item.description.slice(0, 500) || null,
            url: item.link,
            source: source.name,
            publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
          },
          update: {
            title: item.title.slice(0, 500),
            description: item.description.slice(0, 500) || null,
            fetchedAt: new Date(),
          },
        }).catch(() => {});
      }
    } catch {
      // Silently skip failed feeds
    }
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  await fetchAndCacheFeeds();

  const items = await prisma.newsCache.findMany({
    orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
    take: limit,
    skip: offset,
    select: { id: true, title: true, description: true, url: true, source: true, publishedAt: true },
  });

  return NextResponse.json(items, { headers: { 'cache-control': 'public, max-age=300' } });
}
