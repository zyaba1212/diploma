/**
 * Импорт подводных кабелей из GeoJSON (Open Undersea Cable Map, fork TeleGeography CC BY-NC-SA 3.0).
 * По умолчанию: https://raw.githubusercontent.com/stevesong/open_undersea_cable_map/main/cable/cable-geo.json
 *
 * Использование:
 *   node scripts/sync-submarine-cables.mjs
 *   node scripts/sync-submarine-cables.mjs --dry-run
 *   node scripts/sync-submarine-cables.mjs --file ./local-cable-geo.json
 *   node scripts/sync-submarine-cables.mjs --limit 20
 *   SUBMARINE_CABLE_GEO_URL=https://... node scripts/sync-submarine-cables.mjs
 *
 * Лицензия данных: CC BY-NC-SA 3.0 (некоммерческое использование — проверьте соответствие вашему кейсу).
 */
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_GEO_URL =
  'https://raw.githubusercontent.com/stevesong/open_undersea_cable_map/main/cable/cable-geo.json';

const PROVIDER_ID = 'open-undersea-cable-map';
const PROVIDER_NAME = 'Open Undersea Cable Map (Steve Song / TeleGeography fork)';
const PROVIDER_SOURCE = 'https://github.com/stevesong/open_undersea_cable_map';

function parseArgs(argv) {
  let dryRun = false;
  let limit = Infinity;
  let filePath = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error('--limit needs a positive number');
      limit = n;
    } else if (a === '--file') {
      filePath = argv[++i];
      if (!filePath) throw new Error('--file needs a path');
    }
  }
  return { dryRun, limit, filePath };
}

/** @param {unknown} ring */
function ringToPath(ring) {
  if (!Array.isArray(ring) || ring.length < 2) return null;
  const path = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    path.push({ lat, lng });
  }
  return path.length >= 2 ? path : null;
}

function sourceIdForSegment(feature, segIdx) {
  const fid = feature.properties?.feature_id;
  const id = feature.properties?.id;
  const base = typeof fid === 'string' && fid.length > 0 ? fid : typeof id === 'string' ? id : 'unknown';
  return segIdx === 0 ? `oucm-${base}` : `oucm-${base}-s${segIdx}`;
}

async function loadGeoJson(url, filePath) {
  if (filePath) {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
  const res = await fetch(url, { headers: { accept: 'application/geo+json, application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function main() {
  const { dryRun, limit, filePath } = parseArgs(process.argv);
  const url = process.env.SUBMARINE_CABLE_GEO_URL || DEFAULT_GEO_URL;

  console.log(`Source: ${filePath ? filePath : url}`);
  if (dryRun) console.log('DRY RUN — no DB writes');

  const geo = await loadGeoJson(url, filePath);
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('Expected GeoJSON FeatureCollection');
  }

  const providerPayload = {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    scope: 'GLOBAL',
    sourceUrl: PROVIDER_SOURCE,
  };

  /** @type {import('@prisma/client').Prisma.NetworkElementUpsertArgs[]} */
  const upserts = [];

  let featureCount = 0;
  for (const feature of geo.features) {
    if (featureCount >= limit) break;
    if (!feature || feature.type !== 'Feature') continue;

    const geom = feature.geometry;
    if (!geom) continue;

    /** @type {number[][][] | number[][] | null} */
    let multi = null;
    if (geom.type === 'LineString') {
      multi = [geom.coordinates];
    } else if (geom.type === 'MultiLineString') {
      multi = geom.coordinates;
    } else {
      continue;
    }

    if (!Array.isArray(multi)) continue;

    let segIdx = 0;
    for (const ring of multi) {
      const path = ringToPath(ring);
      if (!path) {
        segIdx++;
        continue;
      }
      const sourceId = sourceIdForSegment(feature, segIdx);
      const name =
        typeof feature.properties?.name === 'string'
          ? feature.properties.name + (multi.length > 1 ? ` (${segIdx + 1}/${multi.length})` : '')
          : sourceId;

      upserts.push({
        where: { sourceId },
        create: {
          sourceId,
          scope: 'GLOBAL',
          type: 'CABLE_FIBER',
          providerId: PROVIDER_ID,
          name,
          path,
          metadata: {
            dataset: 'open_undersea_cable_map',
            licenseNote: 'CC BY-NC-SA 3.0 — verify non-commercial use',
            featureId: feature.properties?.feature_id ?? null,
            cableId: feature.properties?.id ?? null,
            color: feature.properties?.color ?? null,
            importedAt: new Date().toISOString(),
          },
        },
        update: {
          name,
          path,
          providerId: PROVIDER_ID,
          metadata: {
            dataset: 'open_undersea_cable_map',
            licenseNote: 'CC BY-NC-SA 3.0 — verify non-commercial use',
            featureId: feature.properties?.feature_id ?? null,
            cableId: feature.properties?.id ?? null,
            color: feature.properties?.color ?? null,
            importedAt: new Date().toISOString(),
          },
        },
      });
      segIdx++;
    }
    featureCount++;
  }

  console.log(`Prepared ${upserts.length} cable segment(s) from ${Math.min(featureCount, geo.features.length)} feature(s)`);

  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  await prisma.networkProvider.upsert({
    where: { id: PROVIDER_ID },
    update: {
      name: PROVIDER_NAME,
      sourceUrl: PROVIDER_SOURCE,
      scope: 'GLOBAL',
    },
    create: providerPayload,
  });

  const BATCH = 25;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const chunk = upserts.slice(i, i + BATCH);
    await prisma.$transaction(chunk.map((args) => prisma.networkElement.upsert(args)));
  }

  // Удалить старую заглушку из ранней версии скрипта (если есть)
  const deleted = await prisma.networkElement.deleteMany({
    where: { sourceId: 'submarine-demo-1' },
  });
  if (deleted.count) console.log(`Removed legacy placeholder rows: ${deleted.count}`);

  console.log('Import finished OK.');
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
