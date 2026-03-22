import type { LatLng, NetworkElementDTO, NetworkResponseDTO } from '@/lib/types';

export type LatLngBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

function addPoint(bounds: LatLngBounds, lat: number, lng: number): void {
  bounds.minLat = Math.min(bounds.minLat, lat);
  bounds.maxLat = Math.max(bounds.maxLat, lat);
  bounds.minLng = Math.min(bounds.minLng, lng);
  bounds.maxLng = Math.max(bounds.maxLng, lng);
}

function addPath(bounds: LatLngBounds, path: LatLng[] | null | undefined): void {
  if (!Array.isArray(path)) return;
  for (const p of path) {
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    addPoint(bounds, p.lat, p.lng);
  }
}

/** Bounding box over all coordinates in the network response (cables + nodes). */
export function computeNetworkBounds(network: NetworkResponseDTO | null): LatLngBounds | null {
  if (!network?.elements?.length) return null;

  const b: LatLngBounds = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
  };

  for (const el of network.elements) {
    addPath(b, el.path);
    if (typeof el.lat === 'number' && typeof el.lng === 'number' && Number.isFinite(el.lat) && Number.isFinite(el.lng)) {
      addPoint(b, el.lat, el.lng);
    }
  }

  if (!Number.isFinite(b.minLat) || b.minLat === Infinity) return null;

  return b;
}

function isRegionalDatasetElement(el: NetworkElementDTO, providersById: Map<string, string>): boolean {
  const meta = el.metadata;
  const ds = meta && typeof meta.dataset === 'string' ? meta.dataset : '';
  if (
    ds === 'gold_coast_fibre_optic_cable' ||
    ds === 'openstreetmap' ||
    ds === 'fallback-reclassified-from-underground-fiber'
  ) {
    return true;
  }
  const sid = typeof el.sourceId === 'string' ? el.sourceId : '';
  if (sid.startsWith('gold-coast') || sid.startsWith('osm-')) return true;
  const pname = el.providerId ? providersById.get(el.providerId) ?? '' : '';
  if (/gold coast|openstreetmap/i.test(pname)) return true;
  return false;
}

/**
 * Bounds for map/globe focus: City of Gold Coast + OSM imports (same bbox as seed), excluding worldwide submarine cables.
 */
export function computeRegionalDataBounds(network: NetworkResponseDTO | null): LatLngBounds | null {
  if (!network?.elements?.length) return null;

  const providersById = new Map(network.providers.map((p) => [p.id, p.name]));

  const b: LatLngBounds = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
  };

  for (const el of network.elements) {
    if (!isRegionalDatasetElement(el, providersById)) continue;
    addPath(b, el.path);
    if (typeof el.lat === 'number' && typeof el.lng === 'number' && Number.isFinite(el.lat) && Number.isFinite(el.lng)) {
      addPoint(b, el.lat, el.lng);
    }
  }

  if (!Number.isFinite(b.minLat) || b.minLat === Infinity) return null;

  return b;
}

export function boundsSpanDeg(bounds: LatLngBounds): { lat: number; lng: number } {
  return {
    lat: Math.abs(bounds.maxLat - bounds.minLat),
    lng: Math.abs(bounds.maxLng - bounds.minLng),
  };
}

/** Center of bounds (for rotating the globe). */
export function centerOfBounds(bounds: LatLngBounds): LatLng {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };
}

/** Expand zero/tiny boxes so Leaflet fitBounds is stable. */
export function padBounds(bounds: LatLngBounds, padDeg = 0.015): LatLngBounds {
  const latSpan = Math.abs(bounds.maxLat - bounds.minLat);
  const lngSpan = Math.abs(bounds.maxLng - bounds.minLng);
  const pLat = latSpan < 1e-6 ? padDeg : 0;
  const pLng = lngSpan < 1e-6 ? padDeg : 0;
  return {
    minLat: bounds.minLat - pLat,
    maxLat: bounds.maxLat + pLat,
    minLng: bounds.minLng - pLng,
    maxLng: bounds.maxLng + pLng,
  };
}

/**
 * Choose bounds for initial map fit: prefer regional (Gold Coast + OSM); if missing, use full network only if not planet-wide.
 */
export function selectBoundsForMapFocus(network: NetworkResponseDTO | null): LatLngBounds | null {
  const regional = computeRegionalDataBounds(network);
  if (regional) return regional;

  const all = computeNetworkBounds(network);
  if (!all) return null;

  const { lat: latSpan, lng: lngSpan } = boundsSpanDeg(all);
  // Above ~50° the view is more "whole hemisphere" than a region; skip auto-fit.
  if (latSpan > 50 || lngSpan > 120) return null;

  return all;
}
