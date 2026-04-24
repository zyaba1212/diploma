/**
 * Backfill server-level source URLs for existing NetworkElement records.
 *
 * Usage:
 *   node scripts/backfill-server-source-urls.mjs
 *   node scripts/backfill-server-source-urls.mjs --dry-run
 */

import { PrismaClient } from '@prisma/client';
import {
  isOperatorGenericLandingUrl,
  isSafeExternalHttpUrlNormalized,
  isWikipediaLikeUrl,
  resolveServerSourceUrl,
} from './lib/resolve-server-source-url.mjs';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const LEGACY_GENERIC_IXP_URL = 'https://en.wikipedia.org/wiki/Internet_exchange_point';

function qualityScore(url) {
  if (!url || !isSafeExternalHttpUrlNormalized(url)) return 0;
  if (url === LEGACY_GENERIC_IXP_URL) return 0;
  if (isOperatorGenericLandingUrl(url)) return 1;
  if (isWikipediaLikeUrl(url)) return 2;
  return 3;
}

function metadataOperator(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const op = metadata.operator;
  return typeof op === 'string' && op.trim() ? op.trim() : null;
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
    const rawMeta = el.metadata;
    const country =
      rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta) && typeof rawMeta.country === 'string'
        ? rawMeta.country
        : undefined;
    const nextUrl = resolveServerSourceUrl({
      name: el.name,
      operator: metadataOperator(el.metadata),
      metadata: el.metadata,
      country,
    });
    if (!nextUrl) continue;
    const shouldReplaceCurrent = qualityScore(nextUrl) > qualityScore(current);
    if (!shouldReplaceCurrent) continue;

    touched += 1;
    if (DRY_RUN) {
      console.log(`[DRY RUN] ${el.id} :: ${el.name ?? '(no name)'} :: ${current || '(empty)'} -> ${nextUrl}`);
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
