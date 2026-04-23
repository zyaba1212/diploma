// geo/normalizeLatLng.ts — приведение географических координат к каноническому виду.
//
// Leaflet при панорамировании через антимеридиан и Three при вращении глобуса
// могут выдавать долготу за пределами (-180, 180] (например, 181, -181, 540).
// Эта утилита клампит широту к [-90, 90] и нормализует долготу к (-180, 180],
// возвращая объект { lat, lng } пригодный как литерал LatLng.

import type { LatLng } from '@/lib/types';

export function normalizeLatLng(lat: number, lng: number): LatLng {
  const safeLat = Number.isFinite(lat) ? lat : 0;
  const safeLng = Number.isFinite(lng) ? lng : 0;

  const clampedLat = Math.max(-90, Math.min(90, safeLat));

  let normLng = ((safeLng + 180) % 360 + 360) % 360 - 180;
  if (normLng === -180) normLng = 180;

  return { lat: clampedLat, lng: normLng };
}
