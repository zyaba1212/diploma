/* eslint-disable no-console */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SMOKE_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function request(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    return { res, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const base = stripTrailingSlash(BASE_URL);
  const { res, body } = await request(`${base}/api/network?scope=GLOBAL`);
  const worldishBbox = '-70,-179,75,179';
  const { res: worldishRes, body: worldishBody } = await request(
    `${base}/api/network?scope=GLOBAL&bbox=${encodeURIComponent(worldishBbox)}&z=2&debugUnderground=1`,
  );
  const { res: worldishMainRes, body: worldishMainBody } = await request(
    `${base}/api/network?scope=GLOBAL&bbox=${encodeURIComponent(worldishBbox)}&z=2&mainUndergroundOnly=1`,
  );

  assert(res.status === 200, `Expected 200 for GET /api/network?scope=GLOBAL, got ${res.status}`);
  assert(worldishRes.status === 200, `Expected 200 for worldish GET /api/network, got ${worldishRes.status}`);
  assert(worldishMainRes.status === 200, `Expected 200 for worldish main-only GET /api/network, got ${worldishMainRes.status}`);
  assert(body && typeof body === 'object', 'Expected JSON object from /api/network');
  assert(worldishBody && typeof worldishBody === 'object', 'Expected JSON object from worldish /api/network');
  assert(worldishMainBody && typeof worldishMainBody === 'object', 'Expected JSON object from worldish main-only /api/network');
  assert(Array.isArray(body.elements), 'Expected elements array in /api/network response');
  assert(Array.isArray(worldishBody.elements), 'Expected elements array in worldish /api/network response');
  assert(Array.isArray(worldishMainBody.elements), 'Expected elements array in worldish main-only /api/network response');

  const elements = body.elements;
  const worldishElements = worldishBody.elements;
  const baseStations = elements.filter((e) => e?.type === 'BASE_STATION').length;
  const undergroundFiber = elements.filter((e) => e?.type === 'CABLE_UNDERGROUND_FIBER').length;
  const undergroundCopper = elements.filter((e) => e?.type === 'CABLE_UNDERGROUND_COPPER').length;
  const worldishUnderground = worldishElements.filter(
    (e) => e?.type === 'CABLE_UNDERGROUND_FIBER' || e?.type === 'CABLE_UNDERGROUND_COPPER',
  ).length;
  const worldishMainUnderground = worldishMainBody.elements.filter(
    (e) => e?.type === 'CABLE_UNDERGROUND_FIBER' || e?.type === 'CABLE_UNDERGROUND_COPPER',
  ).length;
  const servers = elements.filter((e) => e?.type === 'SERVER');
  const serverWithSource = servers.filter((e) => hasValidHttpSourceUrl(e?.sourceUrl)).length;
  const malformedServerSource = servers.filter((e) => {
    const v = e?.sourceUrl;
    if (v == null) return false;
    const t = String(v).trim();
    if (!t) return false;
    return !hasValidHttpSourceUrl(t);
  }).length;

  // After purging synthetic "representative_backbone", nothing in /api/network must carry that dataset
  // or sourceClass='synthetic'. This guards against regressions re-introducing the fake backbone layer.
  const syntheticLeftover = elements.filter((e) => {
    const m = e?.metadata;
    if (!m || typeof m !== 'object') return false;
    return m.dataset === 'representative_backbone' || m.sourceClass === 'synthetic';
  }).length;

  // Count real terrestrial-fibre datasets that replace the removed synthetic layer.
  // We do not require them to be present (imports are opt-in via env flags),
  // but we surface the counts so a green smoke reflects whether real sources are loaded.
  const osmTerrestrialFibre = elements.filter((e) => e?.metadata?.dataset === 'osm_terrestrial_fibre').length;
  const afterfibre = elements.filter((e) => e?.metadata?.dataset === 'afterfibre').length;

  assert(baseStations > 0, `Expected BASE_STATION count > 0, got ${baseStations}`);
  assert(
    undergroundFiber > 0 || undergroundCopper > 0,
    `Expected underground cable types present, got fiber=${undergroundFiber} copper=${undergroundCopper}`,
  );
  assert(servers.length > 0, `Expected SERVER count > 0, got ${servers.length}`);
  assert(serverWithSource > 0, `Expected at least one SERVER with valid sourceUrl, got ${serverWithSource}`);
  assert(malformedServerSource === 0, `Expected malformed SERVER sourceUrl count = 0, got ${malformedServerSource}`);
  assert(
    syntheticLeftover === 0,
    `Expected 0 elements with dataset='representative_backbone' or sourceClass='synthetic' in /api/network, got ${syntheticLeftover}`,
  );
  assert(
    worldishUnderground > 0,
    `Expected at least one underground cable in worldish /api/network response, got ${worldishUnderground}`,
  );
  assert(
    worldishMainUnderground > 0,
    `Expected at least one underground cable in worldish mainUndergroundOnly=1 response, got ${worldishMainUnderground}`,
  );

  const majorDcServers = servers.filter((e) => e?.metadata?.dataset === 'major-datacenters');
  if (majorDcServers.length > 0) {
    const deadAws = majorDcServers.filter((e) => /regions_az\//i.test(String(e?.sourceUrl ?? '')));
    assert(
      deadAws.length === 0,
      `major-datacenters SERVER must not use dead AWS regions_az URLs (count=${deadAws.length})`,
    );
  }

  console.log(
    `Network extent OK: base_station=${baseStations}, underground_fiber=${undergroundFiber}, underground_copper=${undergroundCopper}, underground_worldish=${worldishUnderground}, underground_worldish_main=${worldishMainUnderground}, servers=${servers.length}, servers_with_source=${serverWithSource}, osm_terrestrial_fibre=${osmTerrestrialFibre}, afterfibre=${afterfibre}`,
  );
}

main().catch((err) => {
  console.error('smoke-network-data-extent failed:', err);
  process.exit(1);
});
