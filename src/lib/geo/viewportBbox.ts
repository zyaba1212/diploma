import type { LatLng } from '@/lib/types';

/** [minLat, minLng, maxLat, maxLng] */
export type BboxTuple = readonly [number, number, number, number];

const GLOBE_ZOOM_MIN = 1.2;
const GLOBE_ZOOM_MAX = 6;

/**
 * Оценка bbox видимой области глобуса по центру лицевой стороны и «зуму» камеры (position.z).
 * Чем дальше камера (больше z), тем шире охват.
 */
export function bboxFromGlobeView(center: LatLng, globeZoom: number): BboxTuple {
  const cz = Math.min(GLOBE_ZOOM_MAX, Math.max(GLOBE_ZOOM_MIN, globeZoom));
  const u = (cz - GLOBE_ZOOM_MIN) / (GLOBE_ZOOM_MAX - GLOBE_ZOOM_MIN);
  const latHalf = 4 + u * 80;
  const lngHalf = 6 + u * 170;
  let minLat = center.lat - latHalf;
  let maxLat = center.lat + latHalf;
  const minLng = center.lng - lngHalf;
  const maxLng = center.lng + lngHalf;
  minLat = Math.max(-85, minLat);
  maxLat = Math.min(85, maxLat);
  return [minLat, minLng, maxLat, maxLng];
}

/** Небольшой запас по краям, чтобы при панорамировании не было «дыр» до следующего запроса. */
export function expandBoundsForFetch(b: BboxTuple, ratio = 0.1): BboxTuple {
  const [minLat, minLng, maxLat, maxLng] = b;
  const latPad = Math.max((maxLat - minLat) * ratio, 0.25);
  const lngPad = Math.max((maxLng - minLng) * ratio, 0.25);
  return [
    Math.max(-90, minLat - latPad),
    Math.max(-180, minLng - lngPad),
    Math.min(90, maxLat + latPad),
    Math.min(180, maxLng + lngPad),
  ];
}

/**
 * Грубая проверка пересечения polyline с прямоугольником (AABB пути + пересечение с bbox).
 * Достаточно для отсечения кабелей вне вьюпорта без PostGIS.
 */
export function pathIntersectsBbox(
  points: Array<{ lat: number; lng: number }> | null | undefined,
  bbox: BboxTuple,
): boolean {
  if (!Array.isArray(points) || points.length < 2) return false;
  const [minLat, minLng, maxLat, maxLng] = bbox;
  let pMinLat = Infinity;
  let pMaxLat = -Infinity;
  let pMinLng = Infinity;
  let pMaxLng = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    pMinLat = Math.min(pMinLat, p.lat);
    pMaxLat = Math.max(pMaxLat, p.lat);
    pMinLng = Math.min(pMinLng, p.lng);
    pMaxLng = Math.max(pMaxLng, p.lng);
  }
  if (!Number.isFinite(pMinLat)) return false;
  if (pMaxLat < minLat || pMinLat > maxLat) return false;
  if (pMaxLng < minLng || pMinLng > maxLng) return false;
  return true;
}
