import { prisma } from '@/lib/prisma';

export const NEWS_RSS_SOURCES = [
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

const KEYWORDS_RU = [
  'связь',
  'телеком',
  'сеть',
  'инфраструктура',
  'кабель',
  'спутник',
  'блокчейн',
  'офлайн',
  'транзакц',
  '5g',
  '4g',
  'mesh',
  'starlink',
  'интернет',
  'цифров',
  'беларус',
  'цифровой рубль',
  'радиосвязь',
  'оптоволокн',
  'беспроводн',
  'широкополосн',
];
const KEYWORDS_EN = [
  'network',
  'telecom',
  'satellite',
  'blockchain',
  'offline',
  'mesh',
  '5g',
  'starlink',
  'infrastructure',
  'cable',
  'internet',
  'transaction',
  'connectivity',
  'wireless',
  'fiber',
  'broadband',
  'digital currency',
  'decentralized',
];
const ALL_KEYWORDS = [...KEYWORDS_RU, ...KEYWORDS_EN];

/** Второй уровень: общий IT/безопасность — только если мало записей по основным ключам. */
const BROAD_KEYWORDS_RU = [
  'технолог',
  'гаджет',
  'смартфон',
  'процессор',
  'приложен',
  'операционн',
  'устройств',
  'компьютер',
  'ноутбук',
  'обновлен',
  'прошивк',
  'уязвим',
  'хакер',
  'шифрован',
  'сервер',
  'облак',
  'данн',
];
const BROAD_KEYWORDS_EN = [
  'technology',
  'gadget',
  'smartphone',
  'processor',
  'chip',
  'gpu',
  'cpu',
  'security',
  'vulnerability',
  'patch',
  'firmware',
  'software',
  'hardware',
  'cloud',
  'server',
  'android',
  'ios',
  'windows',
  'linux',
  'google',
  'microsoft',
  'apple',
  'samsung',
  'nvidia',
  'intel',
  'amd',
  'laptop',
  'update',
  'release',
  'developer',
  'open source',
  'encryption',
  'breach',
  'hack',
];
const ALL_BROAD = [...BROAD_KEYWORDS_RU, ...BROAD_KEYWORDS_EN];

/** Макс. записей на один RSS за один проход (защита от слишком больших фидов). */
export const MAX_ITEMS_PER_SOURCE = 40;

/** Если после строгого отбора записей меньше — добираем из «широкого» списка. */
const MIN_ITEMS_BEFORE_BROAD_PAD = 12;

const CACHE_TTL_MS = 30 * 60 * 1000;
let lastFetchedAt = 0;

function matchesKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return ALL_KEYWORDS.some((kw) => lower.includes(kw));
}

function matchesBroadOnly(text: string): boolean {
  const lower = text.toLowerCase();
  return ALL_BROAD.some((kw) => lower.includes(kw));
}

/** Для deep backfill: строгий или расширенный IT/безопасность фильтр по тексту. */
export function matchesRelevanceForNewsCache(text: string): boolean {
  return matchesKeywords(text) || matchesBroadOnly(text);
}

/** Убирает hash и типичные UTM-параметры для лучшей дедупликации по `url`. */
export function normalizeNewsUrl(link: string): string {
  const trimmed = link.trim();
  try {
    const u = new URL(trimmed);
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'fbclid',
      'gclid',
    ]) {
      u.searchParams.delete(key);
    }
    u.hash = '';
    const s = u.toString();
    return s.endsWith('/') && u.pathname !== '/' && u.search === '' ? s.slice(0, -1) : s;
  } catch {
    return trimmed;
  }
}

export type RssItem = { title: string; description: string; link: string; pubDate: string };

export function parseRssXml(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s)?.[1] ??
      block.match(/<title>(.*?)<\/title>/s)?.[1] ??
      '';
    const description =
      block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s)?.[1] ??
      block.match(/<description>(.*?)<\/description>/s)?.[1] ??
      '';
    const link = block.match(/<link>(.*?)<\/link>/s)?.[1] ?? '';
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1] ?? '';
    if (title && link) {
      items.push({
        title: title.trim(),
        description: description.replace(/<[^>]*>/g, '').trim().slice(0, 300),
        link: link.trim(),
        pubDate,
      });
    }
  }
  return items;
}

function itemText(item: RssItem): string {
  return `${item.title} ${item.description}`;
}

/**
 * Отбор для записи в кэш: сначала строгие ключи (тематика связи/сети),
 * при малом числе — добор из IT/безопасности по порядку в RSS (до `maxPerSource`).
 */
export function selectItemsWithCap(items: RssItem[], maxPerSource: number): RssItem[] {
  const cap = Math.max(1, Math.min(maxPerSource, 120));
  const seen = new Set<string>();
  const out: RssItem[] = [];

  const pushUnique = (list: RssItem[]) => {
    for (const it of list) {
      if (out.length >= cap) break;
      const key = normalizeNewsUrl(it.link);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  };

  const relevant = items.filter((item) => matchesKeywords(itemText(item)));
  pushUnique(relevant);

  if (out.length < MIN_ITEMS_BEFORE_BROAD_PAD) {
    const broad = items.filter(
      (item) => !matchesKeywords(itemText(item)) && matchesBroadOnly(itemText(item)),
    );
    pushUnique(broad);
  }

  return out;
}

export function selectItemsForIngest(items: RssItem[]): RssItem[] {
  return selectItemsWithCap(items, MAX_ITEMS_PER_SOURCE);
}

function publishedAtFromItem(item: RssItem): Date | null {
  if (!item.pubDate) return null;
  const d = new Date(item.pubDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Однократная загрузка одного RSS в кэш (для cron/backfill без общего TTL).
 */
export async function ingestRssFeed(
  source: { name: string; url: string },
  opts: {
    maxPerSource?: number;
    /** Если задано — пропускаем записи старше этого числа суток относительно `now`. */
    daysBack?: number;
    now?: Date;
    /** Только посчитать записи после отбора, без записи в БД. */
    dryRun?: boolean;
  } = {},
): Promise<number> {
  const res = await fetch(source.url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return 0;
  const xml = await res.text();
  const items = parseRssXml(xml);
  const max = opts.maxPerSource ?? MAX_ITEMS_PER_SOURCE;
  const selected = selectItemsWithCap(items, max);
  const now = opts.now ?? new Date();
  const cutoff =
    opts.daysBack != null && opts.daysBack > 0
      ? new Date(now.getTime() - opts.daysBack * 86_400_000)
      : null;

  let n = 0;
  for (const item of selected) {
    if (cutoff) {
      const pub = publishedAtFromItem(item);
      if (pub && pub < cutoff) continue;
    }
    if (opts.dryRun) {
      n += 1;
      continue;
    }
    if (await upsertNewsCacheItem(source.name, item)) n += 1;
  }
  return n;
}

/**
 * Upsert из deep backfill (sitemap/API), когда заголовок/описание уже извлечены.
 */
export async function upsertNewsCacheFromDeep(args: {
  sourceName: string;
  url: string;
  title: string;
  description?: string | null;
  publishedAt: Date | null;
}): Promise<boolean> {
  const canonicalUrl = normalizeNewsUrl(args.url);
  const title = args.title.trim().slice(0, 500) || canonicalUrl;
  const description = (args.description?.trim().slice(0, 500) || null) ?? null;
  const publishedAtValue =
    args.publishedAt && !Number.isNaN(args.publishedAt.getTime()) ? args.publishedAt : null;

  try {
    await prisma.newsCache.upsert({
      where: { url: canonicalUrl },
      create: {
        title,
        description,
        url: canonicalUrl,
        source: args.sourceName,
        publishedAt: publishedAtValue,
      },
      update: {
        title,
        description,
        publishedAt: publishedAtValue,
        fetchedAt: new Date(),
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function upsertNewsCacheItem(sourceName: string, item: RssItem): Promise<boolean> {
  const canonicalUrl = normalizeNewsUrl(item.link);
  const publishedAt = item.pubDate ? new Date(item.pubDate) : null;
  const publishedAtValue = publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null;

  try {
    await prisma.newsCache.upsert({
      where: { url: canonicalUrl },
      create: {
        title: item.title.slice(0, 500),
        description: item.description.slice(0, 500) || null,
        url: canonicalUrl,
        source: sourceName,
        publishedAt: publishedAtValue,
      },
      update: {
        title: item.title.slice(0, 500),
        description: item.description.slice(0, 500) || null,
        publishedAt: publishedAtValue,
        fetchedAt: new Date(),
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchAndCacheNews(opts: { force?: boolean } = {}): Promise<{ fetched: number }> {
  if (!opts.force && Date.now() - lastFetchedAt < CACHE_TTL_MS) {
    return { fetched: 0 };
  }
  lastFetchedAt = Date.now();

  let upserts = 0;
  for (const source of NEWS_RSS_SOURCES) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssXml(xml);
      const selected = selectItemsForIngest(items);

      for (const item of selected) {
        const ok = await upsertNewsCacheItem(source.name, item);
        if (ok) upserts += 1;
      }
    } catch {
      // silent skip
    }
  }
  return { fetched: upserts };
}
