/**
 * Import real terrestrial fibre segments for Africa from AfTerFibre.
 *
 * AfTerFibre is a community dataset of terrestrial fibre networks on the African
 * continent, collected from operator maps and regulators.
 *
 *   Project page:  https://afterfibre.nsrc.org/
 *   Downloads:     https://afterfibre.nsrc.org/downloads
 *   License:       CC-BY 4.0 (attribution: "AfTerFibre / NSRC")
 *
 * The public download mirrors are GeoJSON/KMZ — by default this script reads a
 * local GeoJSON file (`--file`) so repeated CI runs do not hammer the source.
 * To fetch directly, pass `--url <geojson-url>`.
 *
 * Idempotency:
 *   - NetworkProvider: single row `afterfibre` (or `-local` for LOCAL scope).
 *   - NetworkElement.sourceId: `afterfibre-<featureId>` (segment suffix if MultiLineString).
 *
 * Usage:
 *   node scripts/sync-afterfibre.mjs --file ./afterfibre.geojson
 *   node scripts/sync-afterfibre.mjs --url https://.../afterfibre.geojson
 *   node scripts/sync-afterfibre.mjs --file ./afterfibre.geojson --dry-run
 *   node scripts/sync-afterfibre.mjs --file ./afterfibre.geojson --limit 500
 *   node scripts/sync-afterfibre.mjs --file ./afterfibre.geojson --scope LOCAL
 */

import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BASE_PROVIDER_ID = 'afterfibre';
const PROVIDER_NAME = 'AfTerFibre — African Terrestrial Fibre';
const PROVIDER_SOURCE_URL = 'https://afterfibre.nsrc.org/';
const PROVIDER_LICENSE_NOTE = 'CC-BY 4.0 — AfTerFibre / NSRC. Attribution required.';
const DATASET = 'afterfibre';
const SOURCE_CLASS = 'official';

function parseArgs(argv) {
  let dryRun = false;
  let limit = Infinity;
  let filePath = null;
  let url = null;
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
    } else if (a === '--url') {
      url = argv[++i];
      if (!url) throw new Error('--url needs a URL');
    } else if (a === '--scope') {
      scope = String(argv[++i] ?? '').toUpperCase();
      if (scope !== 'GLOBAL' && scope !== 'LOCAL') throw new Error('--scope must be GLOBAL or LOCAL');
    }
  }

  return { dryRun, limit, filePath, url, scope };
}

function providerIdForScope(scope) {
  return scope === 'GLOBAL' ? BASE_PROVIDER_ID : `${BASE_PROVIDER_ID}-local`;
}

function featureKey(feature, idx) {
  const fid = typeof feature?.id === 'string' || typeof feature?.id === 'number' ? String(feature.id) : null;
  if (fid) return fid;
  const props = feature?.properties ?? {};
  for (const key of ['id', 'fid', 'FID', 'OBJECTID', 'gid', 'GID', 'uid', 'name', 'Name', 'NAME']) {
    const v = props[key];
    if (v != null) return String(v).trim();
  }
  return `idx${idx}`;
}

function sourceIdFor(scope, key, segIdx) {
  const provider = providerIdForScope(scope);
  const safeKey = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = `${provider}-${safeKey || 'unknown'}`;
  return segIdx === 0 ? base : `${base}-s${segIdx}`;
}

/** @returns {{lat:number,lng:number}[]|null} */
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

async function loadGeoJson({ filePath, url }) {
  if (filePath) {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }
  if (url) {
    const res = await fetch(url, { headers: { accept: 'application/geo+json, application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return res.json();
  }
  throw new Error('Either --file or --url must be provided (AfTerFibre GeoJSON input).');
}

function pickOperator(props) {
  if (!props || typeof props !== 'object') return null;
  for (const key of ['operator', 'Operator', 'OPERATOR', 'owner', 'Owner', 'network', 'Network']) {
    const v = props[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickCountry(props) {
  if (!props || typeof props !== 'object') return null;
  for (const key of ['country', 'Country', 'COUNTRY', 'iso_a3', 'ISO_A3']) {
    const v = props[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickStatus(props) {
  if (!props || typeof props !== 'object') return null;
  for (const key of ['status', 'Status', 'STATUS', 'state', 'State']) {
    const v = props[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pathLengthKm(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1], path[i]);
  return km;
}

function computeAfterfibreMetrics(path) {
  return { lengthKm: pathLengthKm(path) };
}

async function main() {
  const { dryRun, limit, filePath, url, scope } = parseArgs(process.argv);
  const providerId = providerIdForScope(scope);

  console.log(`Import scope: ${scope}`);
  console.log(`Source: ${filePath ?? url ?? '<none>'}`);
  if (dryRun) console.log('DRY RUN — no DB writes');

  const geo = await loadGeoJson({ filePath, url });
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('Expected GeoJSON FeatureCollection');
  }

  const upserts = [];
  let featureCount = 0;

  for (let idx = 0; idx < geo.features.length; idx++) {
    if (featureCount >= limit) break;
    const feature = geo.features[idx];
    if (!feature || feature.type !== 'Feature') continue;

    const geom = feature.geometry;
    if (!geom) continue;

    let multi = null;
    if (geom.type === 'LineString') multi = [geom.coordinates];
    else if (geom.type === 'MultiLineString') multi = geom.coordinates;
    else continue;
    if (!Array.isArray(multi)) continue;

    const props = feature.properties ?? {};
    const key = featureKey(feature, idx);
    const operator = pickOperator(props);
    const country = pickCountry(props);
    const status = pickStatus(props);

    const segments = multi.length;
    for (let segIdx = 0; segIdx < segments; segIdx++) {
      const ring = multi[segIdx];
      const path = ringToPath(ring);
      if (!path) continue;

      const sourceId = sourceIdFor(scope, key, segIdx);
      const baseName = operator
        ? `${operator}${country ? ` — ${country}` : ''}`
        : (typeof props.name === 'string' && props.name.trim() ? props.name.trim() : `AfTerFibre segment ${key}`);
      const name = segments > 1 ? `${baseName} (segment ${segIdx + 1}/${segments})` : baseName;
      const metrics = computeAfterfibreMetrics(path);

      const metadata = {
        dataset: DATASET,
        sourceClass: SOURCE_CLASS,
        licenseNote: PROVIDER_LICENSE_NOTE,
        transportMode: 'underground',
        underground: true,
        submarine: false,
        cableMaterial: 'fiber',
        color: '#7aa2ff',
        lengthKm: Number(metrics.lengthKm.toFixed(2)),
        afterfibre: {
          featureKey: String(key),
          operator: operator ?? null,
          country: country ?? null,
          status: status ?? null,
          segmentIndex: segIdx,
          segmentCount: segments,
        },
        importedAt: new Date().toISOString(),
      };

      upserts.push({
        where: { sourceId },
        create: {
          sourceId,
          scope,
          type: 'CABLE_UNDERGROUND_FIBER',
          providerId,
          name,
          path,
          metadata,
        },
        update: {
          name,
          path,
          providerId,
          metadata,
        },
      });
    }

    featureCount++;
  }

  console.log(`Prepared ${upserts.length} AfTerFibre segment(s) from ${featureCount} feature(s).`);

  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  await prisma.networkProvider.upsert({
    where: { id: providerId },
    update: {
      name: PROVIDER_NAME,
      sourceUrl: PROVIDER_SOURCE_URL,
      scope,
    },
    create: {
      id: providerId,
      name: PROVIDER_NAME,
      scope,
      sourceUrl: PROVIDER_SOURCE_URL,
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
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    process.exit(1);
  });
