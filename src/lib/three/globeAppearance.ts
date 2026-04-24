// three/globeAppearance.ts — фон сцены, дефолтный центр, текстуры глобуса, видимость подписей.

import * as THREE from 'three';
import type { EarthMaterialMode } from '@/lib/earthQuality';
import type { EarthTextureSet } from '@/lib/loadEarthTextures';

export const GLOBE_SCENE_BACKGROUND_HEX = 0x050812;

/** Стартовый «центр карты» при первом открытии глобуса. */
export const GLOBE_DEFAULT_CENTER = { lat: 20, lng: 0 } as const;

export type GlobeLabelCandidate = {
  sprite: THREE.Object3D;
  latRad: number;
  lngRad: number;
  sinLat: number;
  cosLat: number;
};

export function applyLoadedEarthTextures(
  globe: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial | THREE.MeshStandardMaterial>,
  clouds: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial | THREE.MeshStandardMaterial>,
  set: EarthTextureSet,
  materialMode: EarthMaterialMode,
): void {
  const oldGlobeMat = globe.material;
  const oldCloudMat = clouds.material;

  if (materialMode === 'standard') {
    globe.material = new THREE.MeshStandardMaterial({
      map: set.color,
      normalMap: set.normal,
      roughness: 0.62,
      metalness: 0.06,
      emissive: new THREE.Color(0x071428),
      emissiveIntensity: 0.38,
    });
    clouds.material = new THREE.MeshStandardMaterial({
      map: set.clouds,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    });
  } else {
    globe.material = new THREE.MeshPhongMaterial({
      map: set.color,
      normalMap: set.normal,
      specularMap: set.specular,
      shininess: 12,
      specular: new THREE.Color(0x333344),
      emissive: new THREE.Color(0x0a1a28),
      emissiveIntensity: 0.42,
    });
    clouds.material = new THREE.MeshPhongMaterial({
      map: set.clouds,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  oldGlobeMat.dispose();
  oldCloudMat.dispose();
}

const _center = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _toCam = new THREE.Vector3();

/**
 * Показывает подписи только на видимой стороне сферы (относительно камеры на +Z).
 * `cameraZ` — |z| камеры в мировых координатах (как `camera.position.z` на главной сцене).
 * `fovDeg` — опционально вертикальный FOV (градусы); при большом отдалении слегка ужесточает порог.
 */
export function updateGlobeFrontLabelsVisibility(
  candidates: ReadonlyArray<GlobeLabelCandidate>,
  globeGroup: THREE.Group,
  cameraZ: number,
  fovDeg?: number,
): void {
  globeGroup.getWorldPosition(_center);
  const camZ = Math.max(0.12, Math.abs(cameraZ));
  const camPos = new THREE.Vector3(0, 0, camZ);

  let minDot = 0.055 + Math.min(0.14, Math.max(0, camZ - 2.1) * 0.024);
  if (typeof fovDeg === 'number' && fovDeg > 0 && fovDeg < 120) {
    minDot += (fovDeg - 60) * 0.00035;
  }

  for (const c of candidates) {
    c.sprite.getWorldPosition(_worldPos);
    _normal.copy(_worldPos).sub(_center);
    if (_normal.lengthSq() < 1e-10) {
      c.sprite.visible = false;
      continue;
    }
    _normal.normalize();
    _toCam.copy(camPos).sub(_worldPos);
    if (_toCam.lengthSq() < 1e-10) {
      c.sprite.visible = false;
      continue;
    }
    _toCam.normalize();
    c.sprite.visible = _normal.dot(_toCam) > minDot;
  }
}
