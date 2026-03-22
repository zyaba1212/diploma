/**
 * Smoke: GET /api/network?scope=GLOBAL — counts by type and rough geographic extent.
 * Use after seed/import to verify OSM + Gold Coast data is present and in expected region (~Australia).
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-network-data-extent.mjs
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

function addPoint(b, lat, lng) {
  b.minLat = Math.min(b.minLat, lat);
  b.maxLat = Math.max(b.maxLat, lat);
  b.minLng = Math.min(b.minLng, lng);
  b.maxLng = Math.max(b.maxLng, lng);
}

function boundsForElements(elements) {
  const b = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
  for (const el of elements) {
    if (Array.isArray(el.path)) {
      for (const p of el.path) {
        if (p && typeof p.lat === 'number' && typeof p.lng === 'number') addPoint(b, p.lat, p.lng);
      }
    }
    if (typeof el.lat === 'number' && typeof el.lng === 'number') addPoint(b, el.lat, el.lng);
  }
  if (!Number.isFinite(b.minLat)) return null;
  return b;
}

async function main() {
  const url = `${BASE.replace(/\/$/, '')}/api/network?scope=GLOBAL`;
  console.log('GET', url);
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) {
    console.error('HTTP', r.status, await r.text());
    process.exit(1);
  }
  const j = await r.json();
  const elements = Array.isArray(j.elements) ? j.elements : [];
  const byType = {};
  for (const e of elements) {
    const t = e.type || '?';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log('elements_total', elements.length);
  console.log('by_type', byType);
  const gold = elements.filter((e) => e.metadata?.dataset === 'gold_coast_fibre_optic_cable');
  const osm = elements.filter((e) => e.metadata?.dataset === 'openstreetmap');
  console.log('gold_coast_fibre_optic_cable', gold.length);
  console.log('openstreetmap', osm.length);
  const allB = boundsForElements(elements);
  const regB = boundsForElements([...gold, ...osm]);
  if (allB) console.log('bounds_all', allB);
  if (regB) console.log('bounds_gold_plus_osm', regB);
  console.log(
    'hint: UI default center is lat=30,lng=0; regional data is near Gold Coast (~-28,153). Use «К области данных» or 2D auto-fit.',
  );
  console.log('hint: if counts are zero, run prisma seed or import scripts; if LOCAL scope only, EarthScene uses GLOBAL — set SEED_SCOPE=GLOBAL.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
