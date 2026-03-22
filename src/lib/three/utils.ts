import * as THREE from 'three';
import type { LatLng } from '@/lib/types';

/** Углы центра «лицевой» стороны глобуса (ось +Z к камере); для cosd подписей и sync с картой. */
export type GlobeFrontCenterAngles = {
  centerLatRad: number;
  centerLngRad: number;
  sinCenter: number;
  cosCenter: number;
};

const _gfcFront = new THREE.Vector3(0, 0, 1);
const _gfcLocal = new THREE.Vector3();
const _gfcInvQuat = new THREE.Quaternion();

/**
 * Заполняет углы центра лицевой стороны без лишних аллокаций (каждый кадр в animate).
 */
export function computeGlobeFrontCenterAnglesInto(globeGroup: THREE.Group, out: GlobeFrontCenterAngles): boolean {
  _gfcLocal.copy(_gfcFront).applyQuaternion(_gfcInvQuat.copy(globeGroup.quaternion).invert());
  const y = Math.max(-1, Math.min(1, _gfcLocal.y));
  out.centerLatRad = Math.asin(y);
  out.centerLngRad = Math.atan2(_gfcLocal.z, -_gfcLocal.x) - Math.PI;
  if (!Number.isFinite(out.centerLatRad) || !Number.isFinite(out.centerLngRad)) return false;
  out.sinCenter = Math.sin(out.centerLatRad);
  out.cosCenter = Math.cos(out.centerLatRad);
  return true;
}

const _centerLatLngScratch: GlobeFrontCenterAngles = {
  centerLatRad: 0,
  centerLngRad: 0,
  sinCenter: 0,
  cosCenter: 0,
};

export function latLngToVec3(lat: number, lng: number, radius: number): THREE.Vector3 | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

export function computeGlobeCenterLatLng(globeGroup: THREE.Group): LatLng | null {
  if (!computeGlobeFrontCenterAnglesInto(globeGroup, _centerLatLngScratch)) return null;
  const latRad = _centerLatLngScratch.centerLatRad;
  const lngRad = _centerLatLngScratch.centerLngRad;

  const lat = (latRad * 180) / Math.PI;
  let lng = (lngRad * 180) / Math.PI;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;

  return { lat, lng };
}

export function orientGlobeGroupCenterFromLatLng(globeGroup: THREE.Group, lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const DEG2RAD = Math.PI / 180;
  const latRad = lat * DEG2RAD;
  const lngRad = lng * DEG2RAD;

  const y = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const A = lngRad + Math.PI;

  const x = -cosLat * Math.cos(A);
  const z = cosLat * Math.sin(A);

  const localCenterRay = new THREE.Vector3(x, y, z);
  if (localCenterRay.lengthSq() < 1e-12) return;

  const front = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(localCenterRay.normalize(), front);
  globeGroup.quaternion.copy(q);
}

export function makeTextSprite(
  text: string,
  opts?: { background?: string; color?: string; fontSize?: number; fontFamily?: string },
): THREE.Sprite {
  const background = opts?.background ?? 'rgba(0,0,0,0.5)';
  const color = opts?.color ?? '#eaf2ff';
  const fontSize = opts?.fontSize ?? 18;
  const fontFamily = opts?.fontFamily ?? 'Arial, sans-serif';

  const safeText = text.length > 28 ? `${text.slice(0, 25)}...` : text;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const material = new THREE.SpriteMaterial({ color });
    return new THREE.Sprite(material);
  }

  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(safeText);
  const textW = metrics.width;
  const paddingX = Math.max(10, Math.round(fontSize * 0.65));
  const paddingY = Math.max(6, Math.round(fontSize * 0.5));

  canvas.width = Math.ceil(textW + paddingX * 2);
  canvas.height = Math.ceil(fontSize + paddingY * 2);

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'middle';

  const r = Math.max(6, Math.round(fontSize * 0.35));
  const w = canvas.width;
  const h = canvas.height;
  const x0 = 0;
  const y0 = 0;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = background;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
  ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  ctx.arcTo(x0, y0 + h, x0, y0, r);
  ctx.arcTo(x0, y0, x0 + w, y0, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fillText(safeText, paddingX, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);

  const aspect = canvas.width / canvas.height;
  const worldHeight = 0.085;
  sprite.scale.set(worldHeight * aspect, worldHeight, 1);

  return sprite;
}

export function makeTextMesh(
  text: string,
  position: THREE.Vector3,
  opts?: { color?: string; fontSize?: number; fontFamily?: string; kind?: string },
): THREE.Mesh {
  const color = opts?.color ?? '#ffffff';
  const fontSize = opts?.fontSize ?? 22;
  const fontFamily = opts?.fontFamily ?? 'Arial, sans-serif';
  const kind = opts?.kind ?? 'country';

  const safeText = text.length > 28 ? `${text.slice(0, 25)}...` : text;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontWeight = kind === 'country' ? 'bold' : 'normal';
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(safeText);
  const textW = metrics.width;
  const pad = Math.round(fontSize * 0.4);

  canvas.width = Math.ceil(textW + pad * 2);
  canvas.height = Math.ceil(fontSize * 1.6);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = fontSize * 0.35;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = color;
  ctx.fillText(safeText, pad, canvas.height / 2);

  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const aspect = canvas.width / canvas.height;
  const worldH = kind === 'country' ? 0.065 : kind === 'water' ? 0.058 : 0.045;
  const geo = new THREE.PlaneGeometry(worldH * aspect, worldH);
  const mesh = new THREE.Mesh(geo, material);

  mesh.position.copy(position);

  const normal = position.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3().crossVectors(up, normal).normalize();
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
  const north = new THREE.Vector3().crossVectors(normal, east).normalize();

  const m4 = new THREE.Matrix4().makeBasis(east, north, normal);
  mesh.quaternion.setFromRotationMatrix(m4);

  mesh.userData.__worldLabel = true;

  return mesh;
}

export function disposeThreeObject(
  obj: THREE.Object3D,
  disposedMaterials?: WeakSet<THREE.Material>,
  disposedTextures?: WeakSet<THREE.Texture>,
) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      if (child.geometry) child.geometry.dispose();

      const m = child.material;
      const mats: THREE.Material[] = Array.isArray(m) ? m : [m];
      for (const mat of mats) {
        if (!mat) continue;
        if (disposedMaterials && disposedMaterials.has(mat)) continue;

        const texMap = (mat as unknown as { map?: THREE.Texture }).map;
        if (texMap && disposedTextures && !disposedTextures.has(texMap)) {
          disposedTextures.add(texMap);
          texMap.dispose();
        }

        disposedMaterials?.add(mat);
        mat.dispose();
      }
    }
  });
}
