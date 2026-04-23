/* eslint-disable no-console */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SKIP_GEOCODE_SMOKE = process.env.SKIP_GEOCODE_SMOKE === '1';
const SMOKE_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120000);

const DEFAULT_LAT = 48.8566; // Paris
const DEFAULT_LNG = 2.3522;
const LAT = Number(process.env.SMOKE_GEOCODE_LAT || DEFAULT_LAT);
const LNG = Number(process.env.SMOKE_GEOCODE_LNG || DEFAULT_LNG);
const GEOSEARCH_Q = process.env.SMOKE_GEOCODE_Q || 'Lon';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasValidHttpSourceUrl(value) {
  if (typeof value !== 'string') return false;
  const t = value.trim();
  if (!t || /\s/.test(t)) return false;
  return t.startsWith('http://') || t.startsWith('https://');
}

function stripTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        ...(options.headers || {}),
      },
      signal: controller.signal,
      ...options,
    });

    const contentType = res.headers.get('content-type') || '';
    let body;
    try {
      if (contentType.includes('application/json')) body = await res.json();
      else body = await res.text();
    } catch {
      body = null;
    }

    return { res, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const base = stripTrailingSlash(BASE_URL);
  console.log(`Smoke v2 site routes + API proxies against ${base}`);

  // Site routes.
  {
    const { res } = await request(`${base}/`);
    assert(res.status === 200, `Expected 200 for GET /, got ${res.status}`);
  }
  {
    const { res } = await request(`${base}/about`);
    assert(res.status === 200, `Expected 200 for GET /about, got ${res.status}`);
  }
  {
    const { res } = await request(`${base}/global-network`);
    assert(res.status === 200, `Expected 200 for GET /global-network, got ${res.status}`);
  }

  // API network.
  const { res: netRes, body: netBody } = await request(`${base}/api/network?scope=GLOBAL`);
  assert(netRes.status === 200, `Expected 200 for GET /api/network?scope=GLOBAL, got ${netRes.status}`);
  assert(netBody && typeof netBody === 'object', 'Expected JSON object from /api/network');
  assert(Array.isArray(netBody.elements), 'Expected `elements` array in /api/network response');

  const elements = netBody.elements;
  const baseStationCount = elements.filter((e) => e?.type === 'BASE_STATION').length;
  const undergroundFiberCount = elements.filter((e) => e?.type === 'CABLE_UNDERGROUND_FIBER').length;
  const undergroundCopperCount = elements.filter((e) => e?.type === 'CABLE_UNDERGROUND_COPPER').length;
  const servers = elements.filter((e) => e?.type === 'SERVER');
  const serversWithSource = servers.filter((e) => hasValidHttpSourceUrl(e?.sourceUrl)).length;
  const malformedServerSource = servers.filter((e) => {
    const v = e?.sourceUrl;
    if (v == null) return false;
    const t = String(v).trim();
    if (!t) return false;
    return !hasValidHttpSourceUrl(t);
  }).length;

  assert(baseStationCount > 0, `Expected BASE_STATION count > 0, got ${baseStationCount}`);
  assert(
    undergroundFiberCount > 0 || undergroundCopperCount > 0,
    `Expected at least one underground cable type present (fiber>0 or copper>0). got fiber=${undergroundFiberCount} copper=${undergroundCopperCount}`,
  );
  assert(servers.length > 0, `Expected SERVER count > 0, got ${servers.length}`);
  assert(serversWithSource > 0, `Expected at least one SERVER with valid sourceUrl, got ${serversWithSource}`);
  assert(malformedServerSource === 0, `Expected malformed SERVER sourceUrl count = 0, got ${malformedServerSource}`);

  console.log(
    `Network OK: BASE_STATION=${baseStationCount}, underground_fiber=${undergroundFiberCount}, underground_copper=${undergroundCopperCount}, servers=${servers.length}, servers_with_source=${serversWithSource}`,
  );

  // Geocode proxy endpoints (backend should proxy external APIs).
  if (SKIP_GEOCODE_SMOKE) {
    console.log('Skipping geocode checks (SKIP_GEOCODE_SMOKE=1).');
    console.log('Smoke v2 site routes + API proxies: PASS');
    return;
  }

  {
    const { res: geoSearchRes, body: geoSearchBody } = await request(
      `${base}/api/geocode/search?q=${encodeURIComponent(GEOSEARCH_Q)}`,
    );
    assert(geoSearchRes.status === 200, `Expected 200 for GET /api/geocode/search, got ${geoSearchRes.status}`);
    assert(Array.isArray(geoSearchBody), 'Expected JSON array from /api/geocode/search');
    console.log(`Geocode search OK: q=${GEOSEARCH_Q} results=${geoSearchBody.length}`);
  }

  {
    const { res: geoRevRes, body: geoRevBody } = await request(
      `${base}/api/geocode/reverse?lat=${encodeURIComponent(LAT)}&lng=${encodeURIComponent(LNG)}`,
    );
    assert(geoRevRes.status === 200, `Expected 200 for GET /api/geocode/reverse, got ${geoRevRes.status}`);
    assert(isObject(geoRevBody), 'Expected JSON object from /api/geocode/reverse');
    assert(
      typeof geoRevBody.display_name === 'string' && geoRevBody.display_name.length > 0,
      'Expected non-empty `display_name` from /api/geocode/reverse',
    );
    console.log(`Geocode reverse OK: display_name=${geoRevBody.display_name}`);
  }

  console.log('Smoke v2 site routes + API proxies: PASS');
}

main().catch((err) => {
  console.error('Smoke v2 site routes + API proxies: FAIL', err);
  process.exit(1);
});

