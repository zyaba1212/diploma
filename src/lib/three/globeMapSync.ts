import * as THREE from 'three';
import type L from 'leaflet';
import type { LatLng } from '@/lib/types';
import { normalizeLatLng } from '@/lib/geo/normalizeLatLng';
import { computeGlobeCenterLatLng, orientGlobeGroupCenterFromLatLng } from '@/lib/three/utils';

/** Повернуть глобус так, чтобы (lat, lng) оказались в центре лицевой стороны. */
export function syncGlobeToMapCenter(globeGroup: THREE.Group, lat: number, lng: number): void {
  const n = normalizeLatLng(lat, lng);
  orientGlobeGroupCenterFromLatLng(globeGroup, n.lat, n.lng);
}

/** Текущий центр «лицевой» стороны глобуса в lat/lng. */
export function getFrontGlobeCenterLatLng(globeGroup: THREE.Group): LatLng | null {
  const c = computeGlobeCenterLatLng(globeGroup);
  if (!c) return null;
  return normalizeLatLng(c.lat, c.lng);
}

/** Выставить центр Leaflet-карты по координатам (опционально сохранить или задать зум). */
export function applyGlobeCenterToLeafletMap(map: L.Map, center: LatLng, zoom?: number): void {
  const n = normalizeLatLng(center.lat, center.lng);
  const z = zoom !== undefined ? zoom : map.getZoom();
  map.setView([n.lat, n.lng], z);
}
