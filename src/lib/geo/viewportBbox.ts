// geo/viewportBbox.ts — вычисление bbox видимой области (3D-глобус / Leaflet)
// и утилиты для запросов `/api/network` по прямоугольнику.
//
// BboxTuple — порядок [south, west, north, east], совпадающий с Leaflet
// `map.getBounds().get{South,West,North,East}()` и со схемой параметра `bbox`
// в `GET /api/network` (route.ts: [minLat, minLng, maxLat, maxLng]).

import type { LatLng } from '@/lib/types';

export type BboxTuple = [minLat: number, minLng: number, maxLat: number, maxLng: number];

/**
 * Порог «видимости» спутников.
 * В 3D сравнивается с `camera.position.z` (диапазон ~[1.2, 6] в `EarthScene`):
 * при близкой камере (z < 2) спутники скрываются, т.к. их орбита вне кадра.
 * В 2D сравнивается с Leaflet `map.getZoom()` (целые [0..19]): на мировом
 * виде (zoom < 2) точки спутников не показываем, чтобы не замусоривать карту.
 */
export const SATELLITE_MIN_VISIBLE_ZOOM = 2;

/** Радиус сферы глобуса в world-units Three (см. `factories.ts` / `EarthScene`). */
const GLOBE_RADIUS = 1;

/**
 * bbox видимой «шапки» сферы для позиции камеры на расстоянии `zoom` от центра.
 *
 * Геометрия: камера в точке на расстоянии d от центра единичной сферы видит
 * только шапку с угловым полурадиусом α = arccos(R/d). Переводим α в градусы
 * по большому кругу и берём ± по широте, а по долготе масштабируем 1/cos(lat),
 * потому что меридианы сходятся к полюсам. Небольшой множитель 1.1 — запас
 * на перспективу (край шапки чуть заходит за горизонт на FOV ~45°).
 */
export function bboxFromGlobeView(center: LatLng, zoom: number): BboxTuple {
  const d = Math.max(zoom, GLOBE_RADIUS + 1e-3);
  const ratio = Math.min(1, GLOBE_RADIUS / d);
  const alphaRad = Math.acos(ratio);
  const alphaDeg = (alphaRad * 180) / Math.PI;
  const halfSpanDeg = Math.min(90, alphaDeg * 1.1);

  const minLat = Math.max(-90, center.lat - halfSpanDeg);
  const maxLat = Math.min(90, center.lat + halfSpanDeg);

  // Около полюсов cos(lat) → 0, даём клэмп, иначе долгота ушла бы в Infinity.
  const cosLat = Math.max(0.05, Math.cos((center.lat * Math.PI) / 180));
  const halfLngSpan = Math.min(180, halfSpanDeg / cosLat);

  // Если видимая область покрывает более полуокружности по долготе — отдаём
  // полный диапазон, чтобы не городить логику с пересечением антимеридиана:
  // сервер `/api/network` ожидает монотонный bbox (minLng ≤ maxLng).
  if (halfLngSpan >= 180) {
    return [minLat, -180, maxLat, 180];
  }
  const minLng = Math.max(-180, center.lng - halfLngSpan);
  const maxLng = Math.min(180, center.lng + halfLngSpan);
  return [minLat, minLng, maxLat, maxLng];
}

/**
 * Расширяет bbox перед запросом к `/api/network`, чтобы на границе вьюпорта
 * элементы (узлы, кабели) не «моргали» при лёгких сдвигах/зуме. Factor 0.2 =
 * +20% к каждой стороне; серверный cap `pointCap` в route.ts защитит от
 * перебора при полностью мировом bbox.
 */
export function expandBoundsForFetch(bbox: BboxTuple, factor = 0.2): BboxTuple {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const latPad = (maxLat - minLat) * factor;
  const lngPad = (maxLng - minLng) * factor;
  return [
    Math.max(-90, minLat - latPad),
    Math.max(-180, minLng - lngPad),
    Math.min(90, maxLat + latPad),
    Math.min(180, maxLng + lngPad),
  ];
}

/**
 * true — если ломаная `points` пересекает прямоугольник `bbox` (или хотя бы
 * одна её вершина внутри). Используется в `GET /api/network` для отсечения
 * кабелей, путь которых формально выходит за bbox вьюпорта.
 *
 * Клиппинг по Liang–Barsky в (lng, lat)-плоскости. В прод-данных кабели не
 * пересекают антимеридиан чаще, чем единично; этот случай оставлен как TODO —
 * можно предварительно разрезать сегмент по ±180° при необходимости.
 */
export function pathIntersectsBbox(
  points: ReadonlyArray<{ lat: number; lng: number }>,
  bbox: BboxTuple,
): boolean {
  if (points.length === 0) return false;
  const [minLat, minLng, maxLat, maxLng] = bbox;

  for (const p of points) {
    if (p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng) {
      return true;
    }
  }

  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsBbox(points[i], points[i + 1], minLat, minLng, maxLat, maxLng)) {
      return true;
    }
  }
  return false;
}

function segmentIntersectsBbox(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): boolean {
  const dLng = b.lng - a.lng;
  const dLat = b.lat - a.lat;
  const p = [-dLng, dLng, -dLat, dLat];
  const q = [a.lng - minLng, maxLng - a.lng, a.lat - minLat, maxLat - a.lat];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}
