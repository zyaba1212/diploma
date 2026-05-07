/**
 * Импорт новостей в NewsCache.
 *
 * Режимы:
 *   --mode=rss   — только RSS (как раньше), обходит TTL Next.
 *   --mode=deep  — sitemap/API-эвристика по реестру src/lib/news/deepSourceRegistry.ts (глубже RSS-хвоста).
 *
 * RSS:
 *   npx tsx scripts/news-backfill.ts --mode=rss --dry-run
 *   npx tsx scripts/news-backfill.ts --mode=rss --per-source=60 --days-back=90
 *
 * Deep:
 *   npx tsx scripts/news-backfill.ts --mode=deep --dry-run
 *   npx tsx scripts/news-backfill.ts --mode=deep --days-back=14 --max-urls=200 --source=IXBT
 *   npx tsx scripts/news-backfill.ts --mode=deep --from=2025-01-01 --to=2025-06-01 --meta-title=1
 *
 * Требуется DATABASE_URL для записи в БД (не для --dry-run deep, но Prisma всё равно поднимется из news).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ingestRssFeed, NEWS_RSS_SOURCES } from '../src/lib/news';
import { runDeepBackfillAllSources } from '../src/lib/news/deepBackfill';
import { prisma } from '../src/lib/prisma';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFromFile(fileName: string, overrideExisting: boolean) {
  const full = path.join(projectRoot, fileName);
  if (!existsSync(full)) return;
  const text = readFileSync(full, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (overrideExisting || process.env[key] === undefined) process.env[key] = val;
  }
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseYmdStart(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseYmdEnd(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function runRssMode() {
  const dryRun = hasFlag('dry-run');
  const perSource = Math.min(120, Math.max(1, Number(parseArg('per-source')) || 60));
  const daysBack = parseArg('days-back');
  const daysBackN = daysBack != null ? Math.max(0, Number(daysBack) || 0) : undefined;
  const sourceFilter = parseArg('source')?.toLowerCase();
  const globalLimit = parseArg('limit');
  const globalLimitN = globalLimit != null ? Math.max(1, Number(globalLimit) || 0) : undefined;

  if (!dryRun && !process.env.DATABASE_URL) {
    console.error('DATABASE_URL не задан. Добавьте .env или передайте переменную окружения.');
    process.exit(1);
  }

  let total = 0;
  let remaining = globalLimitN ?? Number.POSITIVE_INFINITY;

  const sources = sourceFilter
    ? NEWS_RSS_SOURCES.filter((s) => s.name.toLowerCase().includes(sourceFilter))
    : NEWS_RSS_SOURCES;

  if (sources.length === 0) {
    console.error('Нет источников по фильтру --source=');
    process.exit(1);
  }

  for (const source of sources) {
    if (remaining <= 0) break;
    const maxThis = Math.min(perSource, remaining);
    try {
      const n = await ingestRssFeed(source, {
        maxPerSource: maxThis,
        daysBack: daysBackN,
        dryRun,
      });
      console.log(`${dryRun ? '[dry-run] ' : ''}${source.name}: ${n} записей (cap ${maxThis})`);
      total += n;
      if (globalLimitN !== undefined) remaining -= n;
    } catch (e) {
      console.warn(`${source.name}: ошибка`, e);
    }
  }

  if (!dryRun) {
    const count = await prisma.newsCache.count();
    console.log(`Всего строк в NewsCache: ${count}`);
    await prisma.$disconnect();
  } else {
    console.log(`${dryRun ? '[dry-run] ' : ''}Итого кандидатов (RSS): ${total}`);
  }

  console.log(
    '\nПримечание (RSS): фид отдаёт только хвост ленты. Для глубокой истории используйте --mode=deep.',
  );
}

async function runDeepMode() {
  const dryRun = hasFlag('dry-run');
  const daysBack = parseArg('days-back');
  const daysBackN = daysBack != null ? Math.max(0, Number(daysBack) || 0) : undefined;
  const from = parseYmdStart(parseArg('from'));
  const to = parseYmdEnd(parseArg('to'));
  const maxUrls = Math.min(5000, Math.max(1, Number(parseArg('max-urls')) || 400));
  const maxSitemaps = Math.min(200, Math.max(1, Number(parseArg('max-sitemaps')) || 40));
  const batchConcurrency = Math.min(16, Math.max(1, Number(parseArg('concurrency')) || 4));
  const sourceFilter = parseArg('source') ?? undefined;
  const fetchMetaTitle = hasFlag('meta-title');

  if (!dryRun && !process.env.DATABASE_URL) {
    console.error('DATABASE_URL не задан. Добавьте .env или передайте переменную окружения.');
    process.exit(1);
  }

  const { results, totals } = await runDeepBackfillAllSources({
    sourceFilter,
    daysBack: from == null && to == null ? (daysBackN ?? 30) : undefined,
    from,
    to,
    maxUrlsPerSource: maxUrls,
    maxSitemapFilesPerSource: maxSitemaps,
    maxConcurrency: batchConcurrency,
    fetchMetaTitle,
    dryRun,
  });

  for (const r of results) {
    console.log(
      `${dryRun ? '[dry-run] ' : ''}${r.sourceName}: sitemaps=${r.sitemapsFetched} discovered=${r.urlsDiscovered} path=${r.urlsAfterPathFilter} date=${r.urlsAfterDateFilter} relevance=${r.urlsAfterRelevance} upserted=${r.upserted} dry=${r.dryRunCounted}`,
    );
    if (r.errors.length) console.warn(`  errors: ${r.errors.join('; ')}`);
  }
  console.log('Итого:', totals);

  if (!dryRun) {
    const count = await prisma.newsCache.count();
    console.log(`Всего строк в NewsCache: ${count}`);
    await prisma.$disconnect();
  }
}

async function main() {
  loadEnvFromFile('.env', false);
  loadEnvFromFile('.env.local', true);

  const mode = (parseArg('mode') || 'rss').toLowerCase();
  if (mode === 'deep') {
    await runDeepMode();
    return;
  }
  if (mode === 'rss') {
    await runRssMode();
    return;
  }
  console.error('Неизвестный --mode= (ожидается rss или deep)');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
