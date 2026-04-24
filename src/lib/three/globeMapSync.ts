// three/globeMapSync.ts — согласование центра глобуса (Three) и Leaflet.

import * as THREE from 'three';
import type { LatLng } from '@/lib/types';
import type L from 'leaflet';
import { computeGlobeCenterLatLng, orientGlobeGroupCenterFromLatLng } from '@/lib/three/utils';

export function getFrontGlobeCenterLatLng(globeGroup: THREE.Group): LatLng | null {
  return computeGlobeCenterLatLng(globeGroup);
}

export function syncGlobeToMapCenter(globeGroup: THREE.Group, lat: number, lng: number): void {
  orientGlobeGroupCenterFromLatLng(globeGroup, lat, lng);
}

export function applyGlobeCenterToLeafletMap(map: L.Map, center: LatLng, zoom: number): void {
  map.setView([center.lat, center.lng], zoom, { animate: false });
}
