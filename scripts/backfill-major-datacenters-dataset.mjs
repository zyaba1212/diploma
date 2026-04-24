/**
 * Backfill metadata.dataset for existing major datacenter records.
 *
 * Usage:
 *   node scripts/backfill-major-datacenters-dataset.mjs
 *   node scripts/backfill-major-datacenters-dataset.mjs --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const MAJOR_DATACENTERS_DATASET = 'major-datacenters';
const MAJOR_DC_SOURCE_PREFIX = 'major-dc-';

function buildNextMetadata(metadata) {
  const current =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...metadata }
      : {};

  const next = { ...current };
  next.dataset = MAJOR_DATACENTERS_DATASET;
  next.source = MAJOR_DATACENTERS_DATASET;
  return next;
}

function metadataNeedsUpdate(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true;
  const m = metadata;
  return m.dataset !== MAJOR_DATACENTERS_DATASET || m.source !== MAJOR_DATACENTERS_DATASET;
}

async function main() {
  const elements = await prisma.networkElement.findMany({
    where: {
      sourceId: { startsWith: MAJOR_DC_SOURCE_PREFIX },
    },
    select: {
      id: true,
      sourceId: true,
      metadata: true,
    },
  });

  let touched = 0;
  for (const el of elements) {
    if (!metadataNeedsUpdate(el.metadata)) continue;

    touched += 1;
    const nextMetadata = buildNextMetadata(el.metadata);

    if (DRY_RUN) {
      console.log(`[DRY RUN] ${el.id} (${el.sourceId ?? 'no-source-id'}) -> dataset=${MAJOR_DATACENTERS_DATASET}`);
      continue;
    }

    await prisma.networkElement.update({
      where: { id: el.id },
      data: { metadata: nextMetadata },
    });
  }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Backfill finished. Updated: ${touched} major-datacenter records.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
