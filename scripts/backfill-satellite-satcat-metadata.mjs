/**
 * Backfill SATCAT owner/launch metadata for existing satellite records.
 *
 * Usage:
 *   node scripts/backfill-satellite-satcat-metadata.mjs
 *   node scripts/backfill-satellite-satcat-metadata.mjs --dry-run
 *   node scripts/backfill-satellite-satcat-metadata.mjs --limit 500 --batch-size 100 --concurrency 6
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SATCAT_BASE_URL = process.env.CELESTRAK_SATCAT_URL || 'https://celestrak.org/satcat/records.php';
const SATCAT_TIMEOUT_MS = Number(process.env.CELESTRAK_SATCAT_TIMEOUT_MS || 10000);
const DEFAULT_BATCH_SIZE = 120;
const DEFAULT_CONCURRENCY = Number(process.env.CELESTRAK_SATCAT_CONCURRENCY || 6);
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 350;

function parseArgs(argv) {
  let dryRun = false;
  let limit = 0;
  let batchSize = DEFAULT_BATCH_SIZE;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let retryDelayMs = DEFAULT_RETRY_DELAY_MS;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--limit') {
      limit = Number(argv[++i] ?? 0);
    } else if (arg === '--batch-size') {
      batchSize = Number(argv[++i] ?? DEFAULT_BATCH_SIZE);
    } else if (arg === '--concurrency') {
      concurrency = Number(argv[++i] ?? DEFAULT_CONCURRENCY);
    } else if (arg === '--max-retries') {
      maxRetries = Number(argv[++i] ?? DEFAULT_MAX_RETRIES);
    } else if (arg === '--retry-delay-ms') {
      retryDelayMs = Number(argv[++i] ?? DEFAULT_RETRY_DELAY_MS);
    }
  }

  if (!Number.isFinite(limit) || limit < 0) throw new Error('--limit must be >= 0');
  if (!Number.isFinite(batchSize) || batchSize < 1) throw new Error('--batch-size must be >= 1');
  if (!Number.isFinite(concurrency) || concurrency < 1) throw new Error('--concurrency must be >= 1');
  if (!Number.isFinite(maxRetries) || maxRetries < 0) throw new Error('--max-retries must be >= 0');
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error('--retry-delay-ms must be >= 0');

  return { dryRun, limit, batchSize, concurrency, maxRetries, retryDelayMs };
}

function metadataObject(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return { ...metadata };
}

function metadataString(meta, key) {
  const raw = meta[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function metadataYear(meta, key) {
  const raw = meta[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d{4}$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

function hasOwnerAndLaunch(metadata) {
  const meta = metadataObject(metadata);
  const owner = metadataString(meta, 'owner');
  const launchDate = metadataString(meta, 'launchDate') ?? metadataString(meta, 'launch_date');
  const launchYear = metadataYear(meta, 'launchYear') ?? metadataYear(meta, 'launch_year');
  return Boolean(owner && (launchDate || launchYear !== null));
}

function extractNoradCatId(metadata) {
  const meta = metadataObject(metadata);
  const tle = meta.tle && typeof meta.tle === 'object' && !Array.isArray(meta.tle) ? meta.tle : null;
  const raw = tle?.noradCatId;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return String(Math.trunc(raw));
  if (typeof raw === 'bigint') return String(raw);
  if (typeof raw === 'string') {
    const value = raw.trim();
    return value ? value : null;
  }
  return null;
}

function normalizeSatcatRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw;
  const ownerRaw = rec.OWNER ?? rec.owner ?? rec.owner_name ?? rec.ownerName ?? null;
  const launchDateRaw = rec.LAUNCH_DATE ?? rec.launch_date ?? rec.launchDate ?? null;
  const launchYearRaw = rec.LAUNCH_YEAR ?? rec.launch_year ?? rec.launchYear ?? null;

  const owner = typeof ownerRaw === 'string' ? ownerRaw.trim() : '';
  const launchDate = typeof launchDateRaw === 'string' ? launchDateRaw.trim() : '';
  const launchYearFromDate =
    launchDate.match(/^(\d{4})-/)?.[1] && Number(launchDate.match(/^(\d{4})-/)?.[1]);
  const launchYear =
    typeof launchYearRaw === 'number'
      ? launchYearRaw
      : typeof launchYearRaw === 'string' && /^\d{4}$/.test(launchYearRaw.trim())
        ? Number(launchYearRaw.trim())
        : launchYearFromDate && Number.isFinite(launchYearFromDate)
          ? launchYearFromDate
          : null;

  return {
    owner: owner || null,
    launchDate: launchDate || null,
    launchYear: Number.isFinite(launchYear) ? launchYear : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSatcatSummary(noradCatId, maxRetries, retryDelayMs) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SATCAT_TIMEOUT_MS);
    try {
      const url = `${SATCAT_BASE_URL}?CATNR=${encodeURIComponent(noradCatId)}&FORMAT=JSON`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`SATCAT HTTP ${res.status}`);
      const json = await res.json().catch(() => null);
      const rows = Array.isArray(json) ? json : [];
      return normalizeSatcatRecord(rows[0] ?? null);
    } catch (err) {
      if (attempt >= maxRetries) {
        return {
          error: err instanceof Error ? err.message : String(err),
          summary: null,
        };
      }
      await sleep(retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  return { error: 'unexpected retry state', summary: null };
}

async function runWithConcurrency(items, concurrency, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function mergeMetadataWithSatcat(metadata, satcatSummary) {
  const current = metadataObject(metadata);
  const next = { ...current };
  if (satcatSummary.owner) next.owner = satcatSummary.owner;
  if (satcatSummary.launchDate) next.launchDate = satcatSummary.launchDate;
  if (satcatSummary.launchYear !== null && satcatSummary.launchYear !== undefined) next.launchYear = satcatSummary.launchYear;
  next.satcatBackfilledAt = new Date().toISOString();
  return next;
}

async function main() {
  const args = parseArgs(process.argv);
  const satellites = await prisma.networkElement.findMany({
    where: {
      type: {
        in: ['SATELLITE', 'SATELLITE_RASSVET'],
      },
    },
    select: {
      id: true,
      name: true,
      type: true,
      metadata: true,
    },
    orderBy: { id: 'asc' },
  });

  const candidates = satellites
    .filter((el) => !hasOwnerAndLaunch(el.metadata))
    .map((el) => ({ ...el, noradCatId: extractNoradCatId(el.metadata) }))
    .filter((el) => Boolean(el.noradCatId));
  const selected = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;

  console.log(`Satellite backfill candidates: ${candidates.length}`);
  console.log(`Selected for this run: ${selected.length}`);
  if (selected.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  let updated = 0;
  let notFound = 0;
  let failed = 0;
  let skippedNoDelta = 0;

  for (let i = 0; i < selected.length; i += args.batchSize) {
    const chunk = selected.slice(i, i + args.batchSize);
    const results = await runWithConcurrency(chunk, args.concurrency, async (row) => {
      const satcat = await fetchSatcatSummary(row.noradCatId, args.maxRetries, args.retryDelayMs);
      return { row, satcat };
    });

    for (const result of results) {
      const { row, satcat } = result;
      const summary = satcat?.summary ?? satcat;
      const error = satcat?.error ?? null;
      if (error) {
        failed += 1;
        console.warn(`Failed ${row.id} (${row.noradCatId}): ${error}`);
        continue;
      }
      if (!summary || (!summary.owner && !summary.launchDate && summary.launchYear == null)) {
        notFound += 1;
        continue;
      }

      const nextMetadata = mergeMetadataWithSatcat(row.metadata, summary);
      const alreadyDone = hasOwnerAndLaunch(nextMetadata) && hasOwnerAndLaunch(row.metadata);
      if (alreadyDone) {
        skippedNoDelta += 1;
        continue;
      }

      if (args.dryRun) {
        console.log(
          `[DRY RUN] ${row.id} (${row.name ?? 'no-name'}) owner=${summary.owner ?? '—'} launchDate=${summary.launchDate ?? '—'} launchYear=${summary.launchYear ?? '—'}`,
        );
      } else {
        await prisma.networkElement.update({
          where: { id: row.id },
          data: { metadata: nextMetadata },
        });
      }
      updated += 1;
    }
    console.log(
      `${args.dryRun ? '[DRY RUN] ' : ''}Progress: ${Math.min(i + args.batchSize, selected.length)}/${selected.length}`,
    );
  }

  console.log(`${args.dryRun ? '[DRY RUN] ' : ''}Backfill finished.`);
  console.log(`Updated: ${updated}`);
  console.log(`No SATCAT data: ${notFound}`);
  console.log(`Failed lookups: ${failed}`);
  console.log(`Skipped (already complete): ${skippedNoDelta}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
