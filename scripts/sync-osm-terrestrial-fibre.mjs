/**
 * Import real terrestrial fibre backbone cables from OpenStreetMap via Overpass.
 *
 * Replaces the removed synthetic `representative_backbone` layer.
 *
 * OSM tagging (see https://wiki.openstreetmap.org/wiki/Telecoms):
 *   - `man_made=cable`
 *   - `telecom:medium=fibre`
 *   - (optional) `location=underground`
 *
 * Idempotency:
 *   - NetworkProvider: single row `osm-terrestrial-fibre` (or `-local` for LOCAL scope).
 *   - NetworkElement.sourceId: `osm-terrestrial-fibre-way-<wayId>` (or `-local-way-<wayId>`).
 *
 * Usage:
 *   node scripts/sync-osm-terrestrial-fibre.mjs                   # all regions, default limit
 *   node scripts/sync-osm-terrestrial-fibre.mjs --dry-run
 *   node scripts/sync-osm-terrestrial-fibre.mjs --region EU
 *   node scripts/sync-osm-terrestrial-fibre.mjs --region EU,RU --limit 500
 *   node scripts/sync-osm-terrestrial-fibre.mjs --bbox 34,-10,72,40
 *   node scripts/sync-osm-terrestrial-fibre.mjs --scope LOCAL --region EU
 *
 * Overpass is heavy — this script rate-limits chunks (2s) and retries on 429/504.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BASE_PROVIDER_ID = 'osm-terrestrial-fibre';
const PROVIDER_NAME = 'OpenStreetMap — Terrestrial fibre cables';
const PROVIDER_SOURCE_URL = 'https://www.openstreetmap.org/';
const PROVIDER_LICENSE_NOTE = 'OpenStreetMap data © contributors, ODbL 1.0 — include attribution (per ODbL).';
const DATASET = 'osm_terrestrial_fibre';
const SOURCE_CLASS = 'osm_verified';

/**
 * Conservative regional bounding boxes so Overpass does not time out on world queries.
 * Values are `[minLat, minLng, maxLat, maxLng]` (south, west, north, east).
 * Further chunking per region is applied automatically (see chunkBbox).
 */
const REGIONS = {
  EU: [34.0, -12.0, 72.0, 40.0],       // Western + Central + Northern Europe
  RU: [40.0, 27.0, 82.0, 180.0],        // Russia incl. Siberia
  NA: [14.0, -170.0, 72.0, -50.0],      // North America (US, Canada, Mexico)
  LATAM: [-56.0, -90.0, 14.0, -34.0],   // Latin America + Caribbean
  APAC: [-12.0, 60.0, 55.0, 150.0],     // South + East + SE Asia, Pacific Rim
  AFRICA: [-35.0, -20.0, 38.0, 52.0],   // Africa + western Middle East
  OCEANIA: [-50.0, 110.0, 0.0, 180.0],  // Australia + NZ + Pacific
};

function parseArgs(argv) {
  let dryRun = false;
  let limitPerChunk = 500;
  let scope = 'GLOBAL';
  let regions = Object.keys(REGIONS);
  let bbox = null;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error('--limit needs a positive number');
      limitPerChunk = n;
    } else if (a === '--scope') {
      scope = String(argv[++i] ?? '').toUpperCase();
      if (scope !== 'GLOBAL' && scope !== 'LOCAL') throw new Error('--scope must be GLOBAL or LOCAL');
    } else if (a === '--region') {
      const raw = String(argv[++i] ?? '').toUpperCase();
      const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
      for (const r of list) {
        if (!(r in REGIONS)) throw new Error(`Unknown region "${r}". Known: ${Object.keys(REGIONS).join(', ')}`);
      }
      regions = list;
    } else if (a === '--bbox') {
      const raw = String(argv[++i] ?? '');
      const parts = raw.split(',').map((p) => Number(p.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error('--bbox needs 4 numbers');
      bbox = parts;
    }
  }

  return { dryRun, limitPerChunk, scope, regions, bbox };
}

function providerIdForScope(scope) {
  return scope === 'GLOBAL' ? BASE_PROVIDER_ID : `${BASE_PROVIDER_ID}-local`;
}

function sourceIdForWay(scope, wayId) {
  return scope === 'GLOBAL'
    ? `${BASE_PROVIDER_ID}-way-${wayId}`
    : `${BASE_PROVIDER_ID}-local-way-${wayId}`;
}

/**
 * Split a large bbox into roughly equal-area sub-chunks so Overpass does not
 * timeout. Approx. 20° x 20° chunks — small enough for the `man_made=cable`
 * telecom layer.
 */
function chunkBbox(bbox, maxDeg = 20) {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const chunks = [];
  for (let la = minLat; la < maxLat; la += maxDeg) {
    for (let lo = minLng; lo < maxLng; lo += maxDeg) {
      chunks.push([la, lo, Math.min(la + maxDeg, maxLat), Math.min(lo + maxDeg, maxLng)]);
    }
  }
  return chunks;
}

function buildOverpassQuery(minLat, minLng, maxLat, maxLng) {
  const timeout = 180;
  return `
[out:json][timeout:${timeout}];
(
  // Explicit underground telecom cable tagging.
  way
    ["man_made"="cable"]
    ["location"="underground"]
    ["telecom:medium"~"^(fibre|fiber)$", i]
    (${minLat},${minLng},${maxLat},${maxLng});
  // Same, but location may be omitted in practice.
  way
    ["man_made"="cable"]
    ["telecom:medium"~"^(fibre|fiber)$", i]
    (${minLat},${minLng},${maxLat},${maxLng});
  // Alternate telecom schema.
  way
    ["communication"="line"]
    ["telecom:medium"~"^(fibre|fiber)$", i]
    (${minLat},${minLng},${maxLat},${maxLng});
  // Common cable=* tagging used by some imports.
  way
    ["cable"~"^(fibre_optic|fiber_optic)$", i]
    (${minLat},${minLng},${maxLat},${maxLng});
);
out body geom;
`;
}

function geomToPath(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  const path = [];
  for (const pt of geometry) {
    if (!pt || typeof pt !== 'object') continue;
    const lat = pt.lat;
    const lng = pt.lon ?? pt.lng;
    if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
      path.push({ lat, lng });
    }
  }
  return path.length >= 2 ? path : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOverpass(query, attempt = 1) {
  const endpoint = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
  const res = await fetch(endpoint, {
    method: 'POST',
    // Overpass public instances expect QL in `data=` form payload.
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      accept: 'application/json',
      // Public Overpass instances may reject generic/no user-agent requests with HTTP 406.
      'user-agent': 'diploma-z96a-osm-import/1.0 (+https://www.openstreetmap.org/)',
    },
    body: new URLSearchParams({ data: query }).toString(),
  });

  if (res.status === 429 || res.status === 504 || res.status === 502) {
    if (attempt >= 4) throw new Error(`Overpass HTTP ${res.status} (after ${attempt} attempts)`);
    const backoff = 5000 * attempt;
    console.warn(`Overpass ${res.status}; retrying in ${backoff}ms (attempt ${attempt + 1}/4)`);
    await sleep(backoff);
    return fetchOverpass(query, attempt + 1);
  }

  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

function cableTypeFromTags(tags) {
  const loc = typeof tags?.location === 'string' ? tags.location.toLowerCase() : '';
  if (loc === 'underground') return 'CABLE_UNDERGROUND_FIBER';
  if (loc === 'overhead' || loc === 'overground' || loc === 'aerial') return 'CABLE_FIBER';
  // Default: treat as underground fibre; most real OSM backbone fibre is buried.
  return 'CABLE_UNDERGROUND_FIBER';
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

function computeOsmMetrics(path) {
  return { lengthKm: pathLengthKm(path) };
}

async function main() {
  const { dryRun, limitPerChunk, scope, regions, bbox } = parseArgs(process.argv);
  const providerId = providerIdForScope(scope);

  console.log(`Import scope: ${scope}`);
  console.log(`Dataset: ${DATASET}`);
  if (dryRun) console.log('DRY RUN — no DB writes');

  const bboxesToQuery = [];
  if (bbox) {
    bboxesToQuery.push(...chunkBbox(bbox));
    console.log(`Custom bbox split into ${bboxesToQuery.length} chunk(s)`);
  } else {
    for (const r of regions) {
      const region = REGIONS[r];
      const chunks = chunkBbox(region);
      console.log(`Region ${r}: ${chunks.length} chunk(s)`);
      bboxesToQuery.push(...chunks);
    }
  }

  const allUpserts = [];
  const seenWayIds = new Set();

  for (let i = 0; i < bboxesToQuery.length; i++) {
    const [minLat, minLng, maxLat, maxLng] = bboxesToQuery[i];
    const query = buildOverpassQuery(minLat, minLng, maxLat, maxLng);
    console.log(`[${i + 1}/${bboxesToQuery.length}] Overpass bbox: ${minLat},${minLng},${maxLat},${maxLng}`);

    let data;
    try {
      data = await fetchOverpass(query);
    } catch (err) {
      console.error(`  chunk failed: ${err?.message ?? err}`);
      await sleep(2000);
      continue;
    }

    const elements = Array.isArray(data?.elements) ? data.elements : [];
    const ways = elements.filter((e) => e.type === 'way');
    console.log(`  returned ways: ${ways.length}`);

    for (const way of ways.slice(0, limitPerChunk)) {
      const wayId = way.id;
      if (!wayId) continue;
      if (seenWayIds.has(wayId)) continue;
      seenWayIds.add(wayId);

      const tags = way.tags ?? {};
      const path = geomToPath(way.geometry);
      if (!path) continue;

      const sourceId = sourceIdForWay(scope, wayId);
      const name =
        typeof tags.name === 'string' && tags.name.trim().length > 0
          ? tags.name.trim()
          : typeof tags.ref === 'string' && tags.ref.trim().length > 0
            ? tags.ref.trim()
            : `OSM fibre telecom cable ${wayId}`;

      const type = cableTypeFromTags(tags);
      const isUnderground = type === 'CABLE_UNDERGROUND_FIBER';
      const color = isUnderground ? '#7aa2ff' : '#5ab8ff';
      const metrics = computeOsmMetrics(path);

      const metadata = {
        dataset: DATASET,
        sourceClass: SOURCE_CLASS,
        licenseNote: PROVIDER_LICENSE_NOTE,
        transportMode: isUnderground ? 'underground' : 'aerial',
        underground: isUnderground,
        submarine: false,
        cableMaterial: 'fiber',
        color,
        lengthKm: Number(metrics.lengthKm.toFixed(2)),
        // `osm.id` + `osm.type` is the shape understood by
        // `datasetReferenceLink` in `src/lib/cableSourceLinks.ts`
        // (dataset==='openstreetmap' OR dataset==='osm_terrestrial_fibre').
        osm: {
          id: wayId,
          type: 'way',
          wayId,
          tags,
        },
        importedAt: new Date().toISOString(),
      };

      allUpserts.push({
        where: { sourceId },
        create: {
          sourceId,
          scope,
          type,
          providerId,
          name,
          path,
          metadata,
        },
        update: {
          name,
          path,
          type,
          providerId,
          metadata,
        },
      });
    }

    // Polite pause between chunks to avoid 429.
    if (i < bboxesToQuery.length - 1) await sleep(2000);
  }

  console.log(`Prepared ${allUpserts.length} terrestrial fibre cable segment(s) across ${bboxesToQuery.length} chunk(s).`);

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
  for (let i = 0; i < allUpserts.length; i += BATCH) {
    const chunk = allUpserts.slice(i, i + BATCH);
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
