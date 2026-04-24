/**
 * Purge synthetic `representative_backbone` records and their providers.
 *
 * Removes:
 *  - `NetworkElement.sourceId` LIKE `global-backbone-*`
 *    (those written by the removed `scripts/sync-global-backbone-cables.mjs`
 *    with `metadata.dataset='representative_backbone'`).
 *  - `NetworkProvider.id` LIKE `global-backbone-provider-*`.
 *
 * Usage:
 *   node scripts/purge-representative-backbone.mjs --dry-run
 *   node scripts/purge-representative-backbone.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const elements = await prisma.networkElement.findMany({
    where: { sourceId: { startsWith: 'global-backbone-' } },
    select: { id: true, sourceId: true, name: true, providerId: true },
  });

  const providers = await prisma.networkProvider.findMany({
    where: { id: { startsWith: 'global-backbone-provider-' } },
    select: { id: true, name: true },
  });

  console.log(`Elements matched: ${elements.length}`);
  for (const el of elements) {
    console.log(`  - ${el.sourceId} (${el.name ?? '<no-name>'})`);
  }
  console.log(`Providers matched: ${providers.length}`);
  for (const p of providers) {
    console.log(`  - ${p.id} (${p.name ?? '<no-name>'})`);
  }

  if (DRY_RUN) {
    console.log('[DRY RUN] No changes written.');
    await prisma.$disconnect();
    return;
  }

  const deletedElements = await prisma.networkElement.deleteMany({
    where: { sourceId: { startsWith: 'global-backbone-' } },
  });
  console.log(`Deleted NetworkElement rows: ${deletedElements.count}`);

  const deletedProviders = await prisma.networkProvider.deleteMany({
    where: { id: { startsWith: 'global-backbone-provider-' } },
  });
  console.log(`Deleted NetworkProvider rows: ${deletedProviders.count}`);

  console.log('Purge finished OK.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    process.exit(1);
  });
