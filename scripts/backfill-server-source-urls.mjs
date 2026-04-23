/**
 * Backfill server-level source URLs for existing NetworkElement records.
 *
 * Usage:
 *   node scripts/backfill-server-source-urls.mjs
 *   node scripts/backfill-server-source-urls.mjs --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const LEGACY_GENERIC_IXP_URL = 'https://en.wikipedia.org/wiki/Internet_exchange_point';
const WIKIPEDIA_SEARCH_PREFIX = 'https://en.wikipedia.org/w/index.php?title=Special:Search&search=';

function wikipediaSearchUrl(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  return `${WIKIPEDIA_SEARCH_PREFIX}${encodeURIComponent(q)}`;
}

function awsRegionSourceUrl(name) {
  const m = String(name).match(/\b([a-z]{2}-[a-z]+-\d)\b/i);
  if (!m) return null;
  const region = m[1].toLowerCase();
  return `https://aws.amazon.com/about-aws/global-infrastructure/regions_az/${encodeURIComponent(region)}/`;
}

function metadataSourceUrl(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata;
  const candidates = [m.officialUrl, m.projectUrl, m.url];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function resolveServerSourceUrl(el) {
  const awsRegion = awsRegionSourceUrl(el.name ?? '');
  if (awsRegion) return awsRegion;

  const fromMetadata = metadataSourceUrl(el.metadata);
  if (fromMetadata) return fromMetadata;

  const byName = wikipediaSearchUrl(el.name);
  if (byName) return byName;

  return null;
}

async function main() {
  const servers = await prisma.networkElement.findMany({
    where: { type: 'SERVER' },
    select: {
      id: true,
      name: true,
      sourceId: true,
      sourceUrl: true,
      metadata: true,
    },
  });

  let touched = 0;
  for (const el of servers) {
    const current = typeof el.sourceUrl === 'string' ? el.sourceUrl.trim() : '';
    const shouldReplaceCurrent = !current || current === LEGACY_GENERIC_IXP_URL;
    if (!shouldReplaceCurrent) continue;

    const nextUrl = resolveServerSourceUrl(el);
    if (!nextUrl) continue;

    touched += 1;
    if (DRY_RUN) {
      console.log(`[DRY RUN] ${el.id} :: ${el.name ?? '(no name)'} -> ${nextUrl}`);
      continue;
    }

    await prisma.networkElement.update({
      where: { id: el.id },
      data: { sourceUrl: nextUrl },
    });
  }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Backfill finished. Updated: ${touched} server records.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
