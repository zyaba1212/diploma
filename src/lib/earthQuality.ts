/**
 * Настройки качества глобуса (через NEXT_PUBLIC_* в .env.local, подхватываются при сборке).
 */

export type EarthMaterialMode = 'phong' | 'standard';

/** Верхний предел devicePixelRatio для WebGL (1–4). См. `NEXT_PUBLIC_EARTH_MAX_PIXEL_RATIO`. */
export function getEarthMaxPixelRatio(): number {
  const raw = process.env.NEXT_PUBLIC_EARTH_MAX_PIXEL_RATIO;
  if (raw !== undefined && raw !== '') {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return Math.min(4, Math.max(1, n));
  }
  if (process.env.NEXT_PUBLIC_EARTH_QUALITY === 'high') return 3;
  return 2;
}

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
