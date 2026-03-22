import type { LatLng } from '@/lib/types';

/** Долгота в диапазоне (-180, 180]. */
export function normalizeLng(lng: number): number {
  let v = lng;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

/** Широта в [-90, 90]. */
export function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

/** Привести координаты к валидному диапазону для карт и API геокодинга. */
export function normalizeLatLng(lat: number, lng: number): LatLng {
  return { lat: clampLat(lat), lng: normalizeLng(lng) };
}
