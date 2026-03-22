/**
 * Настройки качества глобуса (через NEXT_PUBLIC_* в .env.local, подхватываются при сборке).
 */

export type EarthMaterialMode = 'phong' | 'standard';

/** Сегменты сферы (32–256): больше = глаже, тяжелее для GPU. */
export function getEarthSphereSegments(): number {
  const explicit = process.env.NEXT_PUBLIC_EARTH_SPHERE_SEGMENTS;
  if (explicit !== undefined && explicit !== '') {
    const n = parseInt(explicit, 10);
    if (Number.isFinite(n)) return Math.min(256, Math.max(32, n));
  }
  if (process.env.NEXT_PUBLIC_EARTH_QUALITY === 'high') {
    return 160;
  }
  return 128;
}

/** Phong — как в примерах three.js; Standard — более естественный свет (PBR-lite, без env-карты). */
export function getEarthMaterialMode(): EarthMaterialMode {
  const m = process.env.NEXT_PUBLIC_EARTH_MATERIAL;
  if (m === 'standard' || m === 'phong') return m;
  if (process.env.NEXT_PUBLIC_EARTH_QUALITY === 'high') return 'standard';
  return 'phong';
}
