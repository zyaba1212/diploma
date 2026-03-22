import * as THREE from 'three';
import type { EarthMaterialMode } from '@/lib/earthQuality';
import type { EarthTextureSet } from '@/lib/loadEarthTextures';
import {
  computeGlobeFrontCenterAnglesInto,
  type GlobeFrontCenterAngles,
} from '@/lib/three/utils';

/** Единый фон сцены для всех глобусов (как в EarthScene). */
export const GLOBE_SCENE_BACKGROUND_HEX = 0x0a2746;

/** Стартовый центр карты/глобуса до пользовательских действий. */
export const GLOBE_DEFAULT_CENTER = Object.freeze({ lat: 30, lng: 0 });

export type GlobeLabelCandidate = {
  sprite: THREE.Object3D;
  latRad: number;
  lngRad: number;
  sinLat: number;
  cosLat: number;
};

/**
 * Применяет загруженные текстуры к сфере Земли и облакам — те же параметры, что в EarthScene.
 */
export function applyLoadedEarthTextures(
  globe: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial | THREE.MeshStandardMaterial>,
  clouds: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial | THREE.MeshStandardMaterial>,
  set: EarthTextureSet,
  materialMode: EarthMaterialMode,
): void {
  let earthMat: THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
  if (materialMode === 'standard') {
    earthMat = new THREE.MeshStandardMaterial({
      map: set.color,
      normalMap: set.normal,
      normalScale: new THREE.Vector2(0.055, 0.055),
      roughness: 0.62,
      metalness: 0.06,
      envMapIntensity: 0,
      emissive: new THREE.Color(0x0b2d55),
      emissiveIntensity: 0.42,
    });
  } else {
    earthMat = new THREE.MeshPhongMaterial({
      map: set.color,
      normalMap: set.normal,
      specularMap: set.specular,
      specular: new THREE.Color(0x2a2a3a),
      shininess: 12,
      emissive: new THREE.Color(0x0b2d55),
    });
  }
  globe.material.dispose();
  globe.material = earthMat;

  const cloudMat =
    materialMode === 'standard'
      ? new THREE.MeshStandardMaterial({
          map: set.clouds,
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
          envMapIntensity: 0,
        })
      : new THREE.MeshPhongMaterial({
          map: set.clouds,
          transparent: true,
          opacity: 0.46,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
  clouds.material.dispose();
  clouds.material = cloudMat;
}

const _centerAngles: GlobeFrontCenterAngles = {
  centerLatRad: 0,
  centerLngRad: 0,
  sinCenter: 0,
  cosCenter: 0,
};

/** Индексы кандидатов в конусе видимости; сортировка по cosd (без аллокаций пар на кадр). */
const _passingLabelIdx: number[] = [];
const _labelCosdScratch: number[] = [];

/**
 * Видимость подписей на «лицевой» стороне глобуса (как в EarthScene): страны, города, воды, узлы сети.
 * После согласования оси +Z одновременно «проходит» много кандидатов — ограничиваем конусом и top-N.
 */
export function updateGlobeFrontLabelsVisibility(
  candidates: GlobeLabelCandidate[],
  globeGroup: THREE.Group,
  zoom: number,
  maxLabels: number = 48,
): void {
  if (candidates.length === 0) return;

  const labelRadiusDeg = zoom < 2.0 ? 10 : zoom < 3.0 ? 14 : 18;
  const cosRadius = Math.cos((labelRadiusDeg * Math.PI) / 180);

  if (!computeGlobeFrontCenterAnglesInto(globeGroup, _centerAngles)) return;
  const { centerLngRad, sinCenter, cosCenter } = _centerAngles;

  const n = candidates.length;
  if (_labelCosdScratch.length < n) _labelCosdScratch.length = n;

  for (let i = 0; i < n; i++) {
    const cand = candidates[i];
    cand.sprite.visible = false;
    const cosd =
      sinCenter * cand.sinLat + cosCenter * cand.cosLat * Math.cos(centerLngRad - cand.lngRad);
    _labelCosdScratch[i] = cosd;
  }

  _passingLabelIdx.length = 0;
  for (let i = 0; i < n; i++) {
    const cosd = _labelCosdScratch[i];
    if (cosd >= cosRadius && cosd > 0) _passingLabelIdx.push(i);
  }
  _passingLabelIdx.sort((a, b) => _labelCosdScratch[b]! - _labelCosdScratch[a]!);

  const cap = Math.min(maxLabels, _passingLabelIdx.length);
  for (let k = 0; k < cap; k++) {
    candidates[_passingLabelIdx[k]!]!.sprite.visible = true;
  }
}
