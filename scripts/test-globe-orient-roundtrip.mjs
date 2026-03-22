/* eslint-disable no-console */
/**
 * Deterministic check: orientGlobeGroupCenterFromLatLng ↔ computeGlobeCenterLatLng (mirrors src/lib/three/utils.ts).
 * Run: node scripts/test-globe-orient-roundtrip.mjs
 */
import * as THREE from 'three';

function normalizeLngDeg(lng) {
  let x = lng;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function computeGlobeCenterLatLngFromQuat(globeQuat) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
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
    const dg = Math.abs(normalizeLngDeg(computed.lng - c.lng));
    assert(dl < 1e-5 && dg < 1e-5, `Roundtrip failed for lat=${c.lat} lng=${c.lng}: got ${computed.lat}, ${computed.lng}`);
  }
  console.log('globe orient roundtrip: OK');
}

main();
