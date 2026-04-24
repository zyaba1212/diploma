/**
 * Импорт подводных кабелей из GeoJSON (Open Undersea Cable Map, fork TeleGeography CC BY-NC-SA 3.0).
 * По умолчанию: https://raw.githubusercontent.com/stevesong/open_undersea_cable_map/main/cable/cable-geo.json
 *
 * Для года и стран дополнительно запрашиваются JSON cable/<id>.json того же источника
 * (один запрос на уникальный id кабеля), если не отключено флагом --no-details.
 *
 * Использование:
 *   node scripts/sync-submarine-cables.mjs
 *   node scripts/sync-submarine-cables.mjs --dry-run
 *   node scripts/sync-submarine-cables.mjs --file ./local-cable-geo.json
 *   node scripts/sync-submarine-cables.mjs --limit 20
 *   node scripts/sync-submarine-cables.mjs --no-details
 *   SUBMARINE_CABLE_GEO_URL=https://... node scripts/sync-submarine-cables.mjs
 *   SUBMARINE_CABLE_DETAIL_BASE_URL=https://raw.githubusercontent.com/.../main/cable/ node ...
 *
 * Лицензия данных: CC BY-NC-SA 3.0
 */
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_GEO_URL =
  'https://raw.githubusercontent.com/stevesong/open_undersea_cable_map/main/cable/cable-geo.json';

/** База URL для cable/<id>.json (заканчивается на /). */
const DEFAULT_DETAIL_BASE_URL =
  'https://raw.githubusercontent.com/stevesong/open_undersea_cable_map/main/cable/';

const PROVIDER_ID = 'open-undersea-cable-map';
const PROVIDER_NAME = 'Open Undersea Cable Map (Steve Song / TeleGeography fork)';
const PROVIDER_SOURCE = 'https://github.com/stevesong/open_undersea_cable_map';

const DETAIL_CONCURRENCY = 12;
const DETAIL_MAX_RETRIES = 3;
const DETAIL_RETRY_BASE_MS = 400;

function parseArgs(argv) {
  let dryRun = false;
  let limit = Infinity;
  let filePath = null;
  let noDetails = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--no-details') noDetails = true;
    else if (a === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error('--limit needs a positive number');
      limit = n;
    } else if (a === '--file') {
      filePath = argv[++i];
      if (!filePath) throw new Error('--file needs a path');
    }
  }
  return { dryRun, limit, filePath, noDetails };
}

function normalizeDetailBaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_DETAIL_BASE_URL;
  const t = raw.trim();
  return t.endsWith('/') ? t : `${t}/`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

/** @param {unknown} obj */
function parseYearFromCableDetail(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const y = /** @type {{ rfs_year?: unknown; rfs?: unknown }} */ (obj).rfs_year;
  if (typeof y === 'number' && Number.isFinite(y)) return y;
  const rfs = /** @type {{ rfs_year?: unknown; rfs?: unknown }} */ (obj).rfs;
  if (typeof rfs === 'string') {
    const m = rfs.trim().match(/^(\d{4})\b/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** @param {unknown} obj */
function officialUrlFromCableDetail(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const raw = /** @type {{ url?: unknown }} */ (obj).url;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t.startsWith('http://') && !t.startsWith('https://')) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return t;
  } catch {
    return null;
  }
}

/** @param {unknown} obj */
function countriesFromCableDetail(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const lp = /** @type {{ landing_points?: unknown }} */ (obj).landing_points;
  if (!Array.isArray(lp)) return [];
  const set = new Set();
  for (const p of lp) {
    if (!p || typeof p !== 'object') continue;
    const c = /** @type {{ country?: unknown }} */ (p).country;
    if (typeof c === 'string' && c.trim()) set.add(c.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
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

async function fetchCableDetailJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

async function fetchCableDetailWithRetry(url) {
  let lastErr;
  for (let attempt = 0; attempt < DETAIL_MAX_RETRIES; attempt++) {
    try {
      return await fetchCableDetailJson(url);
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      const retriable =
        msg.includes('HTTP 429') ||
        msg.includes('HTTP 503') ||
        msg.includes('HTTP 502') ||
        msg.includes('fetch failed');
      if (!retriable || attempt === DETAIL_MAX_RETRIES - 1) throw e;
      await sleep(DETAIL_RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw lastErr;
}

/**
 * @param {string[]} ids
 * @param {string} detailBaseUrl
 * @returns {Promise<Map<string, unknown>>}
 */
async function fetchCableDetailsByIds(ids, detailBaseUrl) {
  const out = new Map();
  const queue = [...ids];
  let failed = 0;

  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (!id) break;
      const url = `${detailBaseUrl}${encodeURIComponent(id)}.json`;
      try {
        const json = await fetchCableDetailWithRetry(url);
        if (json && typeof json === 'object') out.set(id, json);
      } catch (e) {
        failed++;
        console.warn(`[cable detail] skip id=${id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const n = Math.min(DETAIL_CONCURRENCY, Math.max(1, ids.length));
  await Promise.all(Array.from({ length: n }, () => worker()));

  if (failed) console.warn(`[cable detail] ${failed} cable id(s) had fetch errors (metadata may lack year/countries).`);
  return out;
}

function buildMetadata(feature, cableId, detailById, importedAt) {
  const base = {
    dataset: 'open_undersea_cable_map',
    licenseNote: 'CC BY-NC-SA 3.0 — verify non-commercial use',
    featureId: feature.properties?.feature_id ?? null,
    cableId: feature.properties?.id ?? null,
    color: feature.properties?.color ?? null,
    importedAt,
  };

  if (!cableId || typeof cableId !== 'string') return base;

  const detail = detailById.get(cableId);
  if (!detail || typeof detail !== 'object') return base;

  const year = parseYearFromCableDetail(detail);
  const countries = countriesFromCableDetail(detail);
  const rfsRaw = /** @type {{ rfs?: unknown }} */ (detail).rfs;
  const rfs = typeof rfsRaw === 'string' ? rfsRaw : null;
  const officialUrl = officialUrlFromCableDetail(detail);

  return {
    ...base,
    ...(year != null ? { year } : {}),
    ...(countries.length > 0 ? { countries } : {}),
    ...(rfs ? { rfs } : {}),
    ...(officialUrl ? { officialUrl } : {}),
  };
}

async function main() {
  const { dryRun, limit, filePath, noDetails } = parseArgs(process.argv);
  const url = process.env.SUBMARINE_CABLE_GEO_URL || DEFAULT_GEO_URL;
  const detailBaseUrl = normalizeDetailBaseUrl(process.env.SUBMARINE_CABLE_DETAIL_BASE_URL);

  console.log(`Source: ${filePath ? filePath : url}`);
  if (dryRun) console.log('DRY RUN — no DB writes');
  if (noDetails) console.log('--no-details: skipping cable/<id>.json (year/countries will be omitted).');

  const geo = await loadGeoJson(url, filePath);
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('Expected GeoJSON FeatureCollection');
  }

  /** @type {Array<{ feature: any; segIdx: number; path: { lat: number; lng: number }[]; sourceId: string; name: string; cableId: string | null }>} */
  const segments = [];

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

    const cableId =
      typeof feature.properties?.id === 'string' && feature.properties.id.trim()
        ? feature.properties.id.trim()
        : null;

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

      segments.push({ feature, segIdx, path, sourceId, name, cableId });
      segIdx++;
    }
    featureCount++;
  }

  /** @type {Map<string, unknown>} */
  let detailById = new Map();
  if (!noDetails) {
    const uniqueIds = [...new Set(segments.map((s) => s.cableId).filter((id) => id != null))];
    console.log(`Fetching ${uniqueIds.length} cable detail JSON(s) from ${detailBaseUrl}`);
    detailById = await fetchCableDetailsByIds(uniqueIds, detailBaseUrl);
    console.log(`Loaded ${detailById.size} cable detail file(s).`);
  }

  const importedAt = new Date().toISOString();

  /** @type {import('@prisma/client').Prisma.NetworkElementUpsertArgs[]} */
  const upserts = segments.map(({ feature, path, sourceId, name, cableId }) => ({
    where: { sourceId },
    create: {
      sourceId,
      scope: 'GLOBAL',
      type: 'CABLE_FIBER',
      providerId: PROVIDER_ID,
      name,
      path,
      metadata: buildMetadata(feature, cableId, detailById, importedAt),
    },
    update: {
      name,
      path,
      providerId: PROVIDER_ID,
      metadata: buildMetadata(feature, cableId, detailById, importedAt),
    },
  }));

  console.log(`Prepared ${upserts.length} cable segment(s) from ${Math.min(featureCount, geo.features.length)} feature(s)`);

  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  const providerPayload = {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    scope: 'GLOBAL',
    sourceUrl: PROVIDER_SOURCE,
  };

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
