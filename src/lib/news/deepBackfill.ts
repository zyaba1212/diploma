import { matchesRelevanceForNewsCache, NEWS_RSS_SOURCES, upsertNewsCacheFromDeep } from '@/lib/news';

import { type DeepSourceStrategy, getDeepStrategyBySourceName } from '@/lib/news/deepSourceRegistry';

export type DeepBackfillMetrics = {
  sourceName: string;
  sitemapsFetched: number;
  urlsDiscovered: number;
  urlsAfterPathFilter: number;
  urlsAfterDateFilter: number;
  urlsAfterRelevance: number;
  upserted: number;
  dryRunCounted: number;
  errors: string[];
};

export type DeepBackfillOptions = {
  /** Имя источника как в NEWS_RSS_SOURCES (или подстрока для одного прогона). */
  sourceFilter?: string;
  /** Нижняя граница lastmod/published (включительно). */
  from?: Date;
  /** Верхняя граница (включительно). */
  to?: Date;
  /** Альтернатива from: суток назад от now. */
  daysBack?: number;
  now?: Date;
  maxUrlsPerSource?: number;
  maxSitemapFilesPerSource?: number;
  maxConcurrency?: number;
  /** Загружать HTML для og:title (медленнее, но лучше заголовки). */
  fetchMetaTitle?: boolean;
  dryRun?: boolean;
};

const DEFAULT_MAX_URLS = 500;
const DEFAULT_MAX_SITEMAPS = 35;
const DEFAULT_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextWithRetry(url: string): Promise<{ ok: boolean; text: string; status: number }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent':
            'Mozilla/5.0 (compatible; DiplomaNewsDeepBackfill/1.0; +https://www.w3.org/TR/UA-string/)',
          accept: 'application/xml,text/xml,*/*',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      lastStatus = res.status;
      if (!res.ok) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      return { ok: true, text, status: res.status };
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  return { ok: false, text: '', status: lastStatus };
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml) || /<sitemap:index/i.test(xml);
}

function extractChildSitemaps(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim());
  }
  return [...new Set(out)];
}

export type SitemapUrlEntry = { loc: string; lastmod: Date | null };

function parseUrlsetEntries(xml: string): SitemapUrlEntry[] {
  const entries: SitemapUrlEntry[] = [];
  const blockRe = /<url>([\s\S]*?)<\/url>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(xml)) !== null) {
    const block = bm[1];
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1]?.trim();
    if (!loc) continue;
    const lmRaw = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1]?.trim();
    let lastmod: Date | null = null;
    if (lmRaw) {
      const d = new Date(lmRaw);
      if (!Number.isNaN(d.getTime())) lastmod = d;
    }
    entries.push({ loc, lastmod });
  }
  if (entries.length === 0) {
    const locRe = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = locRe.exec(xml)) !== null) {
      entries.push({ loc: m[1].trim(), lastmod: null });
    }
  }
  return entries;
}

function hostnameAllowed(strategy: DeepSourceStrategy, loc: string): boolean {
  if (!strategy.allowedHosts?.length) return true;
  try {
    const h = new URL(loc).hostname.toLowerCase();
    return strategy.allowedHosts.some((x) => x.toLowerCase() === h);
  } catch {
    return false;
  }
}

function pathMatches(strategy: DeepSourceStrategy, loc: string): boolean {
  try {
    const p = new URL(loc).pathname;
    return strategy.urlPathPatterns.some((re) => re.test(p));
  } catch {
    return false;
  }
}

function inDateRange(lastmod: Date | null, from: Date | undefined, to: Date | undefined): boolean {
  if (!from && !to) return true;
  const t = lastmod?.getTime();
  if (t == null || Number.isNaN(t)) {
    if (from || to) return false;
    return true;
  }
  const d = new Date(t);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function titleFromUrlPath(loc: string): string {
  try {
    const u = new URL(loc);
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const decoded = decodeURIComponent(seg).replace(/[-_+]+/g, ' ').trim();
    return decoded.slice(0, 400) || loc;
  } catch {
    return loc.slice(0, 400);
  }
}

async function fetchMetaTitle(loc: string): Promise<string | null> {
  const { ok, text } = await fetchTextWithRetry(loc);
  if (!ok) return null;
  const html = text.slice(0, 200_000);
  const og =
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const tit = html.match(/<title>\s*([^<]{1,300}?)\s*<\/title>/i);
  const raw = og?.[1]?.trim() || tit?.[1]?.trim();
  if (!raw) return null;
  return raw.replace(/\s*\|\s*.+$/, '').replace(/\s*-\s*.+$/, '').trim().slice(0, 500);
}

async function collectFromSitemapTree(
  rootUrl: string,
  strategy: DeepSourceStrategy,
  maxFiles: number,
  metrics: DeepBackfillMetrics,
): Promise<SitemapUrlEntry[]> {
  const visited = new Set<string>();
  const out: SitemapUrlEntry[] = [];
  const queue: string[] = [rootUrl];

  while (queue.length > 0 && visited.size < maxFiles) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    const { ok, text } = await fetchTextWithRetry(url);
    metrics.sitemapsFetched += 1;
    if (!ok) {
      metrics.errors.push(`sitemap fetch failed: ${url}`);
      continue;
    }
    if (isSitemapIndex(text)) {
      const children = extractChildSitemaps(text);
      const cap = strategy.maxChildSitemaps ?? 25;
      for (const c of children.slice(0, cap)) {
        if (visited.size + queue.length < maxFiles) queue.push(c);
      }
    } else {
      out.push(...parseUrlsetEntries(text));
    }
  }
  return out;
}

export async function runDeepBackfillForSource(
  sourceName: string,
  opts: DeepBackfillOptions = {},
): Promise<DeepBackfillMetrics> {
  const strategy = getDeepStrategyBySourceName(sourceName);
  const metrics: DeepBackfillMetrics = {
    sourceName,
    sitemapsFetched: 0,
    urlsDiscovered: 0,
    urlsAfterPathFilter: 0,
    urlsAfterDateFilter: 0,
    urlsAfterRelevance: 0,
    upserted: 0,
    dryRunCounted: 0,
    errors: [],
  };

  if (!strategy) {
    metrics.errors.push(`no deep strategy for source: ${sourceName}`);
    return metrics;
  }

  const now = opts.now ?? new Date();
  let from = opts.from;
  const to = opts.to ?? now;
  if (!from && opts.daysBack != null && opts.daysBack > 0) {
    from = new Date(now.getTime() - opts.daysBack * 86_400_000);
  }

  const maxUrls = Math.min(5000, Math.max(1, opts.maxUrlsPerSource ?? DEFAULT_MAX_URLS));
  const maxSitemaps = Math.min(200, Math.max(1, opts.maxSitemapFilesPerSource ?? DEFAULT_MAX_SITEMAPS));
  const concurrency = Math.min(12, Math.max(1, opts.maxConcurrency ?? DEFAULT_CONCURRENCY));
  const fetchMeta = opts.fetchMetaTitle !== false;

  const allEntries: SitemapUrlEntry[] = [];
  for (const root of strategy.sitemapUrls) {
    if (allEntries.length >= maxUrls * 2) break;
    try {
      const part = await collectFromSitemapTree(root, strategy, maxSitemaps, metrics);
      allEntries.push(...part);
    } catch (e) {
      metrics.errors.push(`${root}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  metrics.urlsDiscovered = allEntries.length;

  const candidates: SitemapUrlEntry[] = [];
  const seen = new Set<string>();
  for (const e of allEntries) {
    if (candidates.length >= maxUrls * 3) break;
    if (!hostnameAllowed(strategy, e.loc)) continue;
    if (!pathMatches(strategy, e.loc)) continue;
    const key = e.loc.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(e);
  }
  metrics.urlsAfterPathFilter = candidates.length;

  const dateFiltered = candidates.filter((e) => inDateRange(e.lastmod, from, to));
  metrics.urlsAfterDateFilter = dateFiltered.length;

  const relevancePassed: { loc: string; lastmod: Date | null; titleGuess: string }[] = [];
  for (const e of dateFiltered) {
    const guess = titleFromUrlPath(e.loc);
    const textProbe = `${guess} ${e.loc}`;
    if (!matchesRelevanceForNewsCache(textProbe)) continue;
    relevancePassed.push({ loc: e.loc, lastmod: e.lastmod, titleGuess: guess });
  }
  metrics.urlsAfterRelevance = relevancePassed.length;

  const slice = relevancePassed.slice(0, maxUrls);

  for (let i = 0; i < slice.length; i += concurrency) {
    const batch = slice.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (row) => {
        let title = row.titleGuess;
        let description: string | null = null;
        if (fetchMeta) {
          const meta = await fetchMetaTitle(row.loc);
          if (meta) title = meta;
        }
        const textForFilter = `${title} ${description ?? ''} ${row.loc}`;
        if (!matchesRelevanceForNewsCache(textForFilter)) return;

        if (opts.dryRun) {
          metrics.dryRunCounted += 1;
          return;
        }
        const ok = await upsertNewsCacheFromDeep({
          sourceName,
          url: row.loc,
          title,
          description,
          publishedAt: row.lastmod,
        });
        if (ok) metrics.upserted += 1;
      }),
    );
  }

  return metrics;
}

export async function runDeepBackfillAllSources(opts: DeepBackfillOptions = {}): Promise<{
  results: DeepBackfillMetrics[];
  totals: {
    upserted: number;
    dryRunCounted: number;
    urlsAfterRelevance: number;
    errors: number;
  };
}> {
  const filter = opts.sourceFilter?.toLowerCase();
  const names = NEWS_RSS_SOURCES.map((s) => s.name).filter((n) =>
    filter ? n.toLowerCase().includes(filter) : true,
  );

  const results: DeepBackfillMetrics[] = [];
  for (const name of names) {
    try {
      results.push(await runDeepBackfillForSource(name, opts));
    } catch (e) {
      results.push({
        sourceName: name,
        sitemapsFetched: 0,
        urlsDiscovered: 0,
        urlsAfterPathFilter: 0,
        urlsAfterDateFilter: 0,
        urlsAfterRelevance: 0,
        upserted: 0,
        dryRunCounted: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  const totals = results.reduce(
    (acc, r) => {
      acc.upserted += r.upserted;
      acc.dryRunCounted += r.dryRunCounted;
      acc.urlsAfterRelevance += r.urlsAfterRelevance;
      acc.errors += r.errors.length;
      return acc;
    },
    { upserted: 0, dryRunCounted: 0, urlsAfterRelevance: 0, errors: 0 },
  );

  return { results, totals };
}
