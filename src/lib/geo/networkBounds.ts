// geo/networkBounds.ts — bbox данных сети для автозумирования карты.
//
// Используется в `MapView` через проп `autoFitBounds`: перед `fitBounds` мы
// добавляем вокруг «сырого» bbox данных небольшой отступ, чтобы точки и
// кабели не прилипали вплотную к краям вьюпорта.

/** Прямоугольник в географических координатах (не путать с Leaflet `LatLngBounds`). */
export type LatLngBounds = {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

/**
 * Раздувает bbox на относительную долю `factor` от его размера по каждой оси
 * (по умолчанию 8%), но не меньше `minPadDeg` градусов — иначе для очень
 * локальных bbox (один дата-центр) отступ был бы визуально нулевым.
 * Результат клампится к валидным диапазонам широты/долготы.
 */
export function padBounds(
  bounds: LatLngBounds,
  factor = 0.08,
  minPadDeg = 0.05,
): LatLngBounds {
  const latSize = bounds.maxLat - bounds.minLat;
  const lngSize = bounds.maxLng - bounds.minLng;
  const latPad = Math.max(latSize * factor, minPadDeg);
  const lngPad = Math.max(lngSize * factor, minPadDeg);
  return {
    minLat: Math.max(-90, bounds.minLat - latPad),
    minLng: Math.max(-180, bounds.minLng - lngPad),
    maxLat: Math.min(90, bounds.maxLat + latPad),
    maxLng: Math.min(180, bounds.maxLng + lngPad),
  };
}
