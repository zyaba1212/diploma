/**
 * Импорт подземных (underground/terrestrial) кабелей из GeoJSON (Data.gov.au: City of Gold Coast).
 *
 * Источник:
 * - Dataset: https://data.gov.au/data/dataset/fibre-optic-cable
 * - WFS GeoJSON: https://data.gov.au/geoserver/fibre-optic-cable/wfs
 *
 * Лицензия данных: CC BY 3.0 Australia (City of Gold Coast).
 * Требуется указание атрибуции и подтверждение на месте:
 * "The information is provided to assist in field investigations. All locations, dimensions and depths shown are to be confirmed on site".
 *
 * Идемпотентность:
 * - NetworkProvider фиксируется providerId
 * - NetworkElement дедуплицируется по sourceId вида
 *   gold-coast-fibre-optic-cable-<featureId>-s<segmentIndex>
 *
 * Использование:
 *   node scripts/sync-underground-cables.mjs
 *   node scripts/sync-underground-cables.mjs --dry-run
 *   node scripts/sync-underground-cables.mjs --file ./local-underground-cables.json
 *   node scripts/sync-underground-cables.mjs --limit 200
 *   node scripts/sync-underground-cables.mjs --scope LOCAL
 *   node scripts/sync-underground-cables.mjs --scope LOCAL --limit 50
 *   UNDERGROUND_CABLE_GEO_URL="https://.../wfs?..." node scripts/sync-underground-cables.mjs
 */

import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_GEO_URL =
  'https://data.gov.au/geoserver/fibre-optic-cable/wfs?request=GetFeature&typeName=ckan_fa5452e4_7713_4c15_b647_ba0191a8c25c&outputFormat=json&maxFeatures=2000';

const PROVIDER_ID = 'gold-coast-fibre-optic-cable';
const PROVIDER_NAME = 'City of Gold Coast — Fibre Optic Cable (data.gov.au)';
const PROVIDER_SOURCE_URL = 'https://data.gov.au/data/dataset/fibre-optic-cable';

const PROVIDER_LICENSE_NOTE =
  'CC BY 3.0 Australia — City of Gold Coast. Attribution required; locations/dimensions/depths must be confirmed on site.';

function parseArgs(argv) {
  let dryRun = false;
  let limit = Infinity;
  let filePath = null;
  let scope = 'GLOBAL';

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
    } else if (a === '--scope') {
      scope = String(argv[++i] ?? '').toUpperCase();
      if (scope !== 'GLOBAL' && scope !== 'LOCAL') throw new Error('--scope must be GLOBAL or LOCAL');
    }
  }

  return { dryRun, limit, filePath, scope };
}

/**
 * @param {unknown} ring One LineString-like ring (array of [lng, lat] points)
 * @returns {{lat:number,lng:number}[]|null}
 */
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

function idForFeature(feature) {
  const fid = typeof feature?.id === 'string' ? feature.id : null;
  if (fid) return fid;
  const pid = typeof feature?.properties?.id === 'string' ? feature.properties.id : null;
  if (pid) return pid;
  const fallback = feature?.properties?.feature_id;
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : 'unknown';
}

function sourceIdForSegment(feature, segIdx) {
  const fid = idForFeature(feature);
  return segIdx === 0 ? `${PROVIDER_ID}-${fid}` : `${PROVIDER_ID}-${fid}-s${segIdx}`;
}

function providerIdForScope(scope) {
  // `NetworkProvider.id` is globally unique in DB, and `NetworkElement.sourceId` is also globally unique.
  // Therefore we must suffix provider/source IDs for `LOCAL` scope to keep them disjoint.
  return scope === 'GLOBAL' ? PROVIDER_ID : `${PROVIDER_ID}-local`;
}

function sourceIdForSegmentScoped(feature, segIdx, scope) {
  const providerId = providerIdForScope(scope);
  const fid = idForFeature(feature);
  return segIdx === 0 ? `${providerId}-${fid}` : `${providerId}-${fid}-s${segIdx}`;
}

/**
 * Maps WFS GeoJSON `feature.properties` from City of Gold Coast fibre layer into NetworkElement.metadata.
 * Known keys from live GetFeature sample (2026): name, visibility, open, address, phoneNumber, description,
 * LookAt, Region, Folder. Extra keys from the service are preserved under `wfsRaw`.
 */
function goldCoastMetadataFromProps(props, { featureId, segmentIndex, segmentCount, color }) {
  const p = props && typeof props === 'object' ? props : {};
  const wfs = {
    name: typeof p.name === 'string' ? p.name : null,
    visibility: typeof p.visibility === 'boolean' ? p.visibility : null,
    open: typeof p.open === 'boolean' ? p.open : null,
    address: p.address ?? null,
    phoneNumber: p.phoneNumber ?? null,
    description: typeof p.description === 'string' && p.description.trim().length > 0 ? p.description.trim() : null,
    LookAt: p.LookAt ?? null,
    Region: p.Region ?? null,
    Folder: typeof p.Folder === 'string' ? p.Folder : null,
  };
  const wfsRaw = { ...p };
  return {
    dataset: 'gold_coast_fibre_optic_cable',
    licenseNote: PROVIDER_LICENSE_NOTE,
    transportMode: 'underground',
    underground: true,
    submarine: false,
    cableMaterial: 'fiber',
    color,
    depthMeters: null,
    featureId,
    segmentIndex,
    segmentCount,
    importedAt: new Date().toISOString(),
    wfs,
    wfsRaw,
  };
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
  const { dryRun, limit, filePath, scope } = parseArgs(process.argv);
  const url = process.env.UNDERGROUND_CABLE_GEO_URL || DEFAULT_GEO_URL;

  console.log(`Source: ${filePath ? filePath : url}`);
  if (dryRun) console.log('DRY RUN — no DB writes');
  console.log(`Import scope: ${scope}`);

  const geo = await loadGeoJson(url, filePath);
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('Expected GeoJSON FeatureCollection');
  }

  /** @type {import('@prisma/client').Prisma.NetworkElementUpsertArgs[]} */
  const upserts = [];
  const providerId = providerIdForScope(scope);

  let featureCount = 0;
  for (const feature of geo.features) {
    if (featureCount >= limit) break;
    if (!feature || feature.type !== 'Feature') continue;

    const geom = feature.geometry;
    if (!geom) continue;

    /** @type {number[][][] | number[][] | null} */
    let multi = null;
    if (geom.type === 'LineString') multi = [geom.coordinates];
    else if (geom.type === 'MultiLineString') multi = geom.coordinates;
    else continue;

    if (!Array.isArray(multi)) continue;

    const segments = multi.length;
    for (let segIdx = 0; segIdx < segments; segIdx++) {
      const ring = multi[segIdx];
      const path = ringToPath(ring);
      if (!path) continue;

      const props = feature.properties ?? {};
      const sourceId = sourceIdForSegmentScoped(feature, segIdx, scope);
      const baseName = typeof props.name === 'string' && props.name.trim().length > 0 ? props.name : sourceId;
      const name = segments > 1 ? `${baseName} (segment ${segIdx + 1}/${segments})` : baseName;

      const color = '#7aa2ff'; // fiber
      const meta = goldCoastMetadataFromProps(props, {
        featureId: idForFeature(feature),
        segmentIndex: segIdx,
        segmentCount: segments,
        color,
      });

      upserts.push({
        where: { sourceId },
        create: {
          sourceId,
          scope,
          type: 'CABLE_UNDERGROUND_FIBER',
          providerId,
          name,
          path,
          metadata: meta,
        },
        update: {
          name,
          path,
          providerId,
          metadata: meta,
        },
      });
    }

    featureCount++;
  }

  console.log(
    `Prepared ${upserts.length} underground cable segment(s) from ${Math.min(featureCount, geo.features.length)} feature(s)`,
  );

  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  await prisma.networkProvider.upsert({
    where: { id: providerId },
    update: {
      name: PROVIDER_NAME,
      sourceUrl: `${PROVIDER_SOURCE_URL} (License note: ${PROVIDER_LICENSE_NOTE})`,
      scope,
    },
    create: {
      id: providerId,
      name: PROVIDER_NAME,
      scope,
      sourceUrl: `${PROVIDER_SOURCE_URL} (License note: ${PROVIDER_LICENSE_NOTE})`,
    },
  });

  const BATCH = 25;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const chunk = upserts.slice(i, i + BATCH);
    await prisma.$transaction(chunk.map((args) => prisma.networkElement.upsert(args)));
  }

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

