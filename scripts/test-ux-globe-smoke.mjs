/* eslint-disable no-console */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      accept: 'text/html, application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  let body;
  const contentType = res.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) body = await res.json();
    else body = await res.text();
  } catch {
    body = null;
  }

  return { res, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasArray(v) {
  return Array.isArray(v);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeLngDeg(lng) {
  let x = lng;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function computeGlobeCenterLatLngFromQuat(globeQuat) {
  // Mirrors EarthScene.computeGlobeCenterLatLng() logic (deterministic inverse test).
  const front = new THREE.Vector3(0, 0, 1);
  const local = front.applyQuaternion(globeQuat.clone().invert());

  const y = Math.max(-1, Math.min(1, local.y));
  const latRad = Math.asin(y);
  const lngRad = Math.atan2(local.z, -local.x) - Math.PI;

  const lat = (latRad * 180) / Math.PI;
  let lng = (lngRad * 180) / Math.PI;
  lng = normalizeLngDeg(lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function orientGlobeGroupCenterFromLatLngQuat(globeQuat, lat, lng) {
  // Mirrors EarthScene.orientGlobeGroupCenterFromLatLng() logic (deterministic inverse test).
  const DEG2RAD = Math.PI / 180;
  const latRad = lat * DEG2RAD;
  const lngRad = lng * DEG2RAD;

  const y = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const A = lngRad + Math.PI;

  const x = -cosLat * Math.cos(A);
  const z = cosLat * Math.sin(A);

  const localCenterRay = new THREE.Vector3(x, y, z);
  if (localCenterRay.lengthSq() < 1e-12) return globeQuat;

  const front = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(localCenterRay.normalize(), front);
  globeQuat.copy(q);
  return globeQuat;
}

function assertNoZoomBasedViewModeAutoSwitch(earthSrc) {
  assert(!earthSrc.includes('ZOOM_THRESHOLD_IN'), 'Expected no ZOOM_THRESHOLD_IN (zoom auto-switch removed).');
  assert(!earthSrc.includes('ZOOM_THRESHOLD_OUT'), 'Expected no ZOOM_THRESHOLD_OUT (zoom auto-switch removed).');
  assert(!earthSrc.includes('hysteresis'), 'Expected no zoom hysteresis code.');

  // Deterministic heuristic:
  // - if zoom auto-switch existed, it would introduce additional setViewMode('MAP_2D') calls outside the manual button.
  // - in v2, manual button should be the single source of switching to MAP_2D.
  const matches = [...earthSrc.matchAll(/setViewMode\(\s*'MAP_2D'\s*\)/g)];
  assert(matches.length >= 1, 'Expected manual setViewMode(\'MAP_2D\') to exist.');
  assert(
    matches.length === 1,
    `Expected exactly 1 setViewMode('MAP_2D') occurrence (manual button only). Found: ${matches.length}`
  );

  const idx = matches[0].index ?? 0;
  const around = earthSrc.slice(Math.max(0, idx - 260), Math.min(earthSrc.length, idx + 80));
  assert(
    around.includes('setMapCenterFromGlobe'),
    'Expected the MAP_2D switch to call setMapCenterFromGlobe() before setViewMode(\'MAP_2D\').'
  );
}

async function main() {
  const cacheBuster = crypto.randomBytes(6).toString('hex');

  console.log(`UX globe smoke checks against ${BASE_URL}`);

  const earthSrc = await fs.readFile(path.join(repoRoot, 'src/components/EarthScene.tsx'), 'utf8');
  const mapViewSrc = await fs.readFile(path.join(repoRoot, 'src/components/MapView.tsx'), 'utf8');
  const siteHeaderSrc = await fs.readFile(path.join(repoRoot, 'src/components/SiteHeader.tsx'), 'utf8');

  // 1) Routes should render without Next runtime/prerender errors.
  const { res: homeRes, body: homeBody } = await request(`${BASE_URL}/?ux_smoke=${cacheBuster}`);
  assert(homeRes.status === 200, `Expected 200 for GET /, got ${homeRes.status}`);
  assert(typeof homeBody === 'string' && homeBody.length > 0, 'Expected HTML body for GET /.');

  const { res: aboutRes, body: aboutBody } = await request(`${BASE_URL}/about`);
  assert(aboutRes.status === 200, `Expected 200 for GET /about, got ${aboutRes.status}`);
  assert(typeof aboutBody === 'string' && aboutBody.includes('О нас'), 'Expected about page to contain "О нас".');

  const { res: gnRes, body: gnBody } = await request(`${BASE_URL}/global-network`);
  assert(gnRes.status === 200, `Expected 200 for GET /global-network, got ${gnRes.status}`);
  assert(typeof gnBody === 'string' && gnBody.length > 0, 'Expected HTML body for GET /global-network.');

  // 2) Network API works + includes underground cables & base stations.
  const { res: netRes, body: netBody } = await request(`${BASE_URL}/api/network?scope=GLOBAL`);
  assert(netRes.status === 200, `Expected 200 for GET /api/network?scope=GLOBAL, got ${netRes.status}`);
  assert(netBody && typeof netBody === 'object', 'Expected JSON object from /api/network');
  assert(hasArray(netBody.providers), 'Expected `providers` array in /api/network response');
  assert(hasArray(netBody.elements), 'Expected `elements` array in /api/network response');

  const types = new Set((netBody.elements || []).map((e) => e?.type).filter(Boolean));
  assert(types.has('BASE_STATION'), 'Expected BASE_STATION to be present in /api/network?scope=GLOBAL.');
  assert(
    types.has('CABLE_UNDERGROUND_FIBER') || types.has('CABLE_UNDERGROUND_COPPER'),
    'Expected at least one underground cable type (CABLE_UNDERGROUND_FIBER/CABLE_UNDERGROUND_COPPER) in /api/network?scope=GLOBAL.'
  );

  // 3) Geocode proxy endpoints (backend should proxy external APIs).
  if (process.env.SKIP_GEOCODE_SMOKE !== '1') {
    const { res: geoSearchRes, body: geoSearchBody } = await request(`${BASE_URL}/api/geocode/search?q=London`);
    assert(geoSearchRes.status === 200, `Expected 200 for GET /api/geocode/search, got ${geoSearchRes.status}`);
    assert(Array.isArray(geoSearchBody), 'Expected JSON array from /api/geocode/search');

    const { res: geoRevRes, body: geoRevBody } = await request(`${BASE_URL}/api/geocode/reverse?lat=48.8566&lng=2.3522`);
    assert(geoRevRes.status === 200, `Expected 200 for GET /api/geocode/reverse, got ${geoRevRes.status}`);
    assert(isObject(geoRevBody), 'Expected JSON object from /api/geocode/reverse');
    assert(typeof geoRevBody.display_name === 'string' && geoRevBody.display_name.length > 0, 'Expected display_name');
  } else {
    console.log('Skipping geocode smoke (SKIP_GEOCODE_SMOKE=1).');
  }

  // 4) Deterministic v2 UX invariants (static checks in sources).

  // 4.1) Header skeleton: centered "Главная" + "Глобальная сеть" only on "/" and "/about".
  assert(siteHeaderSrc.includes('justifyContent: \'center\'') || siteHeaderSrc.includes('justifyContent: "center"'), 'Expected centered header title.');
  assert(siteHeaderSrc.includes("pathname === '/' || pathname === '/about'"), 'Expected global-network button visibility only on / and /about.');
  assert(siteHeaderSrc.includes('href="/global-network"'), 'Expected header button link to /global-network.');

  // 4.2) Auto-switch 3D -> 2D via zoom must be disabled.
  assertNoZoomBasedViewModeAutoSwitch(earthSrc);

  // 4.3) 3D <-> 2D centering/orientation consistency: deterministic inverse test of compute/orient math.
  {
    const groupQuat = new THREE.Quaternion();
    const cases = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 20 },
      { lat: -45, lng: 80 },
      { lat: 60, lng: -120 },
    ];
    for (const c of cases) {
      orientGlobeGroupCenterFromLatLngQuat(groupQuat, c.lat, c.lng);
      const computed = computeGlobeCenterLatLngFromQuat(groupQuat);
      assert(computed, 'Inverse center computation returned null.');
      const dl = Math.abs(computed.lat - c.lat);
      const dln = Math.abs(normalizeLngDeg(computed.lng) - normalizeLngDeg(c.lng));
      assert(dl < 1e-4 && dln < 1e-4, `Expected compute/orient inverse within tolerance; got dl=${dl}, dLng=${dln} for ${JSON.stringify(c)}.`);
    }
  }

  // 4.4) 3D -> 2D: Leaflet center comes from current globe center.
  assert(earthSrc.includes('computeGlobeCenterLatLng(globeGroup)'), 'Expected 3D->2D to use computeGlobeCenterLatLng(globeGroup).');
  assert(earthSrc.includes('setTargetCenter(center)'), 'Expected setMapCenterFromGlobe() to set targetCenter.');
  assert(earthSrc.includes('setReverseCenter(center)'), 'Expected setMapCenterFromGlobe() to set reverseCenter.');
  assert(earthSrc.includes('setMapCenterFromGlobe();') && earthSrc.includes("setViewMode('MAP_2D')"), 'Expected 2D switch button to call setMapCenterFromGlobe() then setViewMode(\'MAP_2D\').');

  // 4.5) 2D -> 3D: globe orientation comes from current Leaflet center.
  assert(earthSrc.includes('map.getCenter()'), 'Expected 2D->3D transition to use map.getCenter().');
  assert(
    earthSrc.includes('orientGlobeGroupCenterFromLatLng(globeGroup, c.lat, c.lng)'),
    'Expected 2D->3D transition to orient globe group from Leaflet center lat/lng.'
  );

  // 4.6) 2D user location notification/marker (geolocation automation is not reliable; validate presence of state + rendering code).
  assert(earthSrc.includes('Ваше местоположение:'), 'Expected 2D location notification to render "Ваше местоположение:".');
  assert(earthSrc.includes('navigator.geolocation.getCurrentPosition'), 'Expected geolocation to be requested in MAP_2D mode.');
  assert(mapViewSrc.includes('2D user location marker') || mapViewSrc.includes('circleMarker'), 'Expected MapView to render userLocation marker.');
  assert(mapViewSrc.includes('L.circleMarker([lat, lng]') && mapViewSrc.includes('L.circle([lat, lng]'), 'Expected MapView to render accuracy circle + marker.');

  // 4.7) Settlement search dropdown: up to 3 visible items + scroll, and selection recenters the map.
  assert(/maxHeight:\s*searchResults\.length\s*>\s*3\s*\?\s*3\s*\*\s*40/.test(earthSrc), 'Expected dropdown maxHeight capped for >3 results.');
  assert(/overflowY:\s*searchResults\.length\s*>\s*3\s*\?\s*'auto'/.test(earthSrc), 'Expected dropdown overflowY auto for >3 results.');
  assert(earthSrc.includes('onClick={() => handleSelectSearchResult(r)}'), 'Expected dropdown items to call handleSelectSearchResult.');
  assert(earthSrc.includes('setTargetCenter({ lat, lng })') || earthSrc.includes('setTargetCenter({lat, lng})'), 'Expected handleSelectSearchResult to update targetCenter for recenter.');
  assert(
    earthSrc.includes('setSearchDropdownVisible(false)'),
    'Expected handleSelectSearchResult to hide dropdown after selection.'
  );
  assert(earthSrc.includes('center={targetCenter}'), 'Expected MapView to receive center={targetCenter}.');

  // 4.8) Satellite nodes must be satellite-like: validate renderer uses createSatelliteObject (DOM/visual check cannot be automated reliably here).
  assert(earthSrc.includes('const satelliteObj = createSatelliteObject'), 'Expected SATELLITE nodes to be created via createSatelliteObject().');
  assert(earthSrc.includes('function createSatelliteObject('), 'Expected createSatelliteObject() implementation to exist.');

  // 4.9) Underground cables + base stations rendered in both 2D and 3D.
  assert(earthSrc.includes('CABLE_UNDERGROUND_FIBER') && earthSrc.includes('CABLE_UNDERGROUND_COPPER'), 'Expected 3D renderer to handle underground cable types.');
  assert(earthSrc.includes('BASE_STATION'), 'Expected 3D renderer to handle BASE_STATION nodes.');
  assert(mapViewSrc.includes('CABLE_UNDERGROUND_FIBER') && mapViewSrc.includes('CABLE_UNDERGROUND_COPPER'), 'Expected 2D renderer to draw underground cable types.');
  assert(mapViewSrc.includes('BASE_STATION'), 'Expected 2D renderer to draw BASE_STATION nodes.');

  // 5) Backward-compatible route should still render (legacy alias).
  const { res: legacyRes } = await request(`${BASE_URL}/cables`);
  assert(legacyRes.status === 200, `Expected 200 for GET /cables, got ${legacyRes.status}`);

  console.log('UX v2 smoke checks passed.');
  console.log('Manual verification needed: (1) confirm `SATELLITE` visually looks like a satellite model; (2) verify 2D user location label/marker with real geolocation permission.');
}

main().catch((err) => {
  console.error('UX v2 smoke checks failed:', err);
  process.exit(1);
});

