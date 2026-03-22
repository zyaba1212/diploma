import * as THREE from 'three';

/**
 * Набор текстур планеты (как в официальных примерах three.js).
 * По умолчанию — CDN threejs.org; для офлайна положите файлы в `public/textures/earth/`
 * и задайте `NEXT_PUBLIC_EARTH_TEXTURE_BASE=/textures/earth/` (с завершающим `/`).
 *
 * Для 4K/8K: положите файлы в `public/textures/earth/` и задайте имена через
 * `NEXT_PUBLIC_EARTH_MAP_FILE` и т.д. (см. `getEarthTextureFilenames`).
 */
export type EarthTextureSet = {
  color: THREE.Texture;
  normal: THREE.Texture;
  specular: THREE.Texture;
  clouds: THREE.Texture;
};

/** Имена файлов относительно `NEXT_PUBLIC_EARTH_TEXTURE_BASE` (или дефолтный CDN). */
export function getEarthTextureFilenames(): {
  color: string;
  normal: string;
  specular: string;
  clouds: string;
} {
  return {
    color: process.env.NEXT_PUBLIC_EARTH_MAP_FILE ?? 'earth_atmos_2048.jpg',
    normal: process.env.NEXT_PUBLIC_EARTH_NORMAL_FILE ?? 'earth_normal_2048.jpg',
    specular: process.env.NEXT_PUBLIC_EARTH_SPECULAR_FILE ?? 'earth_specular_2048.jpg',
    clouds: process.env.NEXT_PUBLIC_EARTH_CLOUDS_FILE ?? 'earth_clouds_1024.png',
  };
}

function configureTexture(tex: THREE.Texture, anisotropy: number) {
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
}

export function getEarthTextureBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_EARTH_TEXTURE_BASE;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`;
  }
  return 'https://threejs.org/examples/textures/planets/';
}

/**
 * Загружает color / normal / specular / clouds. При ошибке — null (оставить fallback-материал).
 */
export function loadEarthTextures(renderer: THREE.WebGLRenderer): Promise<EarthTextureSet | null> {
  const base = getEarthTextureBaseUrl();
  const names = getEarthTextureFilenames();
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());

  const loadOne = (file: string) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        `${base}${file}`,
        (tex) => {
          configureTexture(tex, maxAniso);
          resolve(tex);
        },
        undefined,
        (err) => reject(err ?? new Error(`failed to load ${file}`)),
      );
    });

  return Promise.all([
    loadOne(names.color),
    loadOne(names.normal),
    loadOne(names.specular),
    loadOne(names.clouds),
  ])
    .then(([color, normal, specular, clouds]) => {
      color.colorSpace = THREE.SRGBColorSpace;
      normal.colorSpace = THREE.LinearSRGBColorSpace;
      specular.colorSpace = THREE.LinearSRGBColorSpace;
      clouds.colorSpace = THREE.SRGBColorSpace;
      return { color, normal, specular, clouds };
    })
    .catch(() => null);
}

export function disposeEarthTextures(set: EarthTextureSet | null) {
  if (!set) return;
  set.color.dispose();
  set.normal.dispose();
  set.specular.dispose();
  set.clouds.dispose();
}
