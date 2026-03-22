import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Minimal placeholder: real TLE import will be extended later.
// Idempotent: uses sourceId for dedupe.

async function main() {
  const provider = await prisma.networkProvider.upsert({
    where: { id: 'satellites' },
    update: {},
    create: {
      id: 'satellites',
      name: 'Satellites',
      scope: 'GLOBAL',
      sourceUrl: 'https://celestrak.org/',
    },
  });

  await prisma.networkElement.upsert({
    where: { sourceId: 'sat-demo-iss' },
    update: {
      providerId: provider.id,
      scope: 'GLOBAL',
      type: 'SATELLITE',
      name: 'Demo satellite',
      lat: 10,
      lng: 20,
      altitude: 420,
      metadata: { importedAt: new Date().toISOString() },
    },
    create: {
      providerId: provider.id,
      scope: 'GLOBAL',
      type: 'SATELLITE',
      name: 'Demo satellite',
      sourceId: 'sat-demo-iss',
      lat: 10,
      lng: 20,
      altitude: 420,
      metadata: { importedAt: new Date().toISOString() },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

