// Инкрементальное обновление кабелей/узлов на глобусе (EarthScene) без полного clear группы.

import * as THREE from 'three';
import type { NetworkElementDTO } from '@/lib/types';
import { EQUIPMENT_FACTORIES, NODE_VISUALS, createSatelliteObject } from '@/lib/three/factories';
import { latLngToVec3, disposeThreeObject } from '@/lib/three/utils';

type ElementState = { root: THREE.Object3D; sig: string };

function isSatelliteNetworkType(type: string): boolean {
  return type === 'SATELLITE' || type === 'SATELLITE_RASSVET';
}

/** Материалы кабелей + плоскость клипа — один экземпляр на приложение (не dispose при удалении отдельной линии). */
let cableKitSingleton: {
  cableMatFiberSub: THREE.LineBasicMaterial;
  cableMatCopperSub: THREE.LineBasicMaterial;
  cableMatFiberUnd: THREE.LineDashedMaterial;
  cableMatCopperUnd: THREE.LineDashedMaterial;
} | null = null;

function getCableKit() {
  if (cableKitSingleton) return cableKitSingleton;
  const cableClipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.15);
  const cableClip = [cableClipPlane];
  const cableMatFiberSub = new THREE.LineBasicMaterial({
    color: 0x3a7bd5,
    transparent: true,
    opacity: 0.9,
    clippingPlanes: cableClip,
  });
  const cableMatCopperSub = new THREE.LineBasicMaterial({
    color: 0xd4a54a,
    transparent: true,
    opacity: 0.9,
    clippingPlanes: cableClip,
  });
  const cableMatFiberUnd = new THREE.LineDashedMaterial({
    color: 0x00e676,
    transparent: true,
    opacity: 0.8,
    dashSize: 0.04,
    gapSize: 0.03,
    depthTest: false,
    depthWrite: false,
    clippingPlanes: cableClip,
  });
  const cableMatCopperUnd = new THREE.LineDashedMaterial({
    color: 0xff7043,
    transparent: true,
    opacity: 0.75,
    dashSize: 0.04,
    gapSize: 0.03,
    depthTest: false,
    depthWrite: false,
    clippingPlanes: cableClip,
  });
  cableKitSingleton = {
    cableMatFiberSub,
    cableMatCopperSub,
    cableMatFiberUnd,
    cableMatCopperUnd,
  };
  return cableKitSingleton;
}

function elementGeometrySignature(el: NetworkElementDTO): string {
  const pathKey =
    el.path?.map((p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`).join(';') ?? '';
  return JSON.stringify([
    el.type,
    el.scope,
    el.providerId ?? null,
    el.name ?? null,
    el.sourceUrl ?? null,
    el.lat ?? null,
    el.lng ?? null,
    el.altitude ?? null,
    pathKey,
    el.metadata ?? null,
  ]);
}

function seedSharedCableMaterialsForDispose(disposedMaterials: WeakSet<THREE.Material>) {
  const kit = getCableKit();
  disposedMaterials.add(kit.cableMatFiberSub);
  disposedMaterials.add(kit.cableMatCopperSub);
  disposedMaterials.add(kit.cableMatFiberUnd);
  disposedMaterials.add(kit.cableMatCopperUnd);
}

function disposeElementRoot(
  root: THREE.Object3D,
  disposedMaterials: WeakSet<THREE.Material>,
  disposedTextures: WeakSet<THREE.Texture>,
) {
  seedSharedCableMaterialsForDispose(disposedMaterials);
  disposeThreeObject(root, disposedMaterials, disposedTextures);
}

function buildElementRoot(
  el: NetworkElementDTO,
  providerNameById: Map<string, string>,
): THREE.Object3D | null {
  const type = el.type;
  const kit = getCableKit();

  const isSubFiber = type === 'CABLE_FIBER';
  const isSubCopper = type === 'CABLE_COPPER';
  const isUndFiber = type === 'CABLE_UNDERGROUND_FIBER';
  const isUndCopper = type === 'CABLE_UNDERGROUND_COPPER';
  const isCable = (isSubFiber || isSubCopper || isUndFiber || isUndCopper) && Array.isArray(el.path);

  if (isCable && el.path) {
    const radius = isUndFiber || isUndCopper ? 1.002 : 1.001;
    let mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    if (isUndFiber) mat = kit.cableMatFiberUnd;
    else if (isUndCopper) mat = kit.cableMatCopperUnd;
    else if (isSubFiber) mat = kit.cableMatFiberSub;
    else mat = kit.cableMatCopperSub;

    const pts = el.path
      .map((p) => latLngToVec3(p.lat, p.lng, radius))
      .filter((v): v is THREE.Vector3 => Boolean(v));
    if (pts.length < 2) return null;

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, mat);
    if (mat instanceof THREE.LineDashedMaterial) {
      line.computeLineDistances();
    }
    line.frustumCulled = false;
    const providerName = el.providerId ? (providerNameById.get(el.providerId) ?? '') : '';
    line.userData = {
      elName: el.name,
      elType: type,
      providerId: el.providerId ?? '',
      providerName,
      sourceUrl: el.sourceUrl ?? '',
      metadata: el.metadata,
      scope: el.scope,
      hoverKey: el.id,
    };
    return line;
  }

  if (typeof el.lat !== 'number' || typeof el.lng !== 'number') return null;
  const nodeVisuals = NODE_VISUALS;
  const visual = nodeVisuals[type];
  if (!visual) return null;

  let altitudeKm = 0;
  if (typeof el.altitude === 'number' && Number.isFinite(el.altitude)) altitudeKm = el.altitude;
  else if (isSatelliteNetworkType(type)) altitudeKm = 550;
  const nodeR = isSatelliteNetworkType(type) ? 1.0 + altitudeKm / 6371 : 1.012 + (visual.size - 0.01) * 0.9;

  const pos = latLngToVec3(el.lat, el.lng, nodeR);
  if (!pos) return null;

  const normal = pos.clone().normalize();
  const providerName = el.providerId ? (providerNameById.get(el.providerId) ?? '') : '';
  const elUserData = {
    elName: el.name,
    elType: type,
    providerId: el.providerId ?? '',
    providerName,
    sourceUrl: el.sourceUrl ?? '',
    metadata: el.metadata,
    scope: el.scope,
    hoverKey: el.id,
  };

  if (isSatelliteNetworkType(type)) {
    const satelliteObj = createSatelliteObject(visual.size, visual.color, visual.emissive);
    satelliteObj.position.copy(pos);
    satelliteObj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    satelliteObj.userData = elUserData;
    return satelliteObj;
  }

  const factory = EQUIPMENT_FACTORIES[type];
  let marker: THREE.Object3D;
  if (factory) {
    marker = factory(visual.size, visual.color, visual.emissive);
  } else {
    marker = createSatelliteObject(visual.size, visual.color, visual.emissive);
  }
  marker.position.copy(pos);
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  marker.userData = elUserData;
  return marker;
}

/** Обновляет только `userData.providerName` у корней (смена карты имён без смены геометрии). */
export function updateGlobeNetworkElementProviderNames(
  elementsGroup: THREE.Group,
  providerNameById: Map<string, string>,
  idToProviderId: Map<string, string | null | undefined>,
) {
  for (const root of elementsGroup.children) {
    const id = root.userData?.hoverKey as string | undefined;
    if (!id) continue;
    const pid = idToProviderId.get(id);
    const pn = pid ? (providerNameById.get(pid) ?? '') : '';
    const ud = root.userData as { providerName?: string } | undefined;
    if (ud) ud.providerName = pn;
  }
}

export function clearGlobeNetworkElements(
  elementsGroup: THREE.Group,
  stateById: Map<string, ElementState>,
  disposedTextures: WeakSet<THREE.Texture>,
) {
  const disposedMaterials = new WeakSet<THREE.Material>();
  seedSharedCableMaterialsForDispose(disposedMaterials);
  for (const { root } of stateById.values()) {
    if (root.parent === elementsGroup) elementsGroup.remove(root);
    disposeElementRoot(root, disposedMaterials, disposedTextures);
  }
  stateById.clear();
  for (const child of elementsGroup.children.slice()) {
    elementsGroup.remove(child);
    disposeElementRoot(child, disposedMaterials, disposedTextures);
  }
}

export type SyncGlobeNetworkElementsArgs = {
  elements: NetworkElementDTO[];
  elementsGroup: THREE.Group;
  providerNameById: Map<string, string>;
  stateById: Map<string, ElementState>;
  disposedTextures: WeakSet<THREE.Texture>;
};

/**
 * Синхронизирует `elementsGroup` с массивом элементов: удаление по id, добавление, замена при смене сигнатуры геометрии.
 */
export function syncGlobeNetworkElements(args: SyncGlobeNetworkElementsArgs): void {
  const { elements, elementsGroup, providerNameById, stateById, disposedTextures } = args;
  const disposedMaterials = new WeakSet<THREE.Material>();
  seedSharedCableMaterialsForDispose(disposedMaterials);

  const byId = new Map<string, NetworkElementDTO>();
  for (const el of elements) {
    byId.set(el.id, el);
  }

  for (const id of [...stateById.keys()]) {
    if (!byId.has(id)) {
      const entry = stateById.get(id);
      if (entry) {
        elementsGroup.remove(entry.root);
        disposeElementRoot(entry.root, disposedMaterials, disposedTextures);
      }
      stateById.delete(id);
    }
  }

  for (const el of elements) {
    const sig = elementGeometrySignature(el);
    const existing = stateById.get(el.id);
    if (existing && existing.sig === sig) {
      continue;
    }
    if (existing) {
      elementsGroup.remove(existing.root);
      disposeElementRoot(existing.root, disposedMaterials, disposedTextures);
      stateById.delete(el.id);
    }
    const root = buildElementRoot(el, providerNameById);
    if (!root) continue;
    elementsGroup.add(root);
    stateById.set(el.id, { root, sig });
  }

  const idToProviderId = new Map<string, string | null | undefined>();
  for (const el of elements) {
    idToProviderId.set(el.id, el.providerId);
  }
  updateGlobeNetworkElementProviderNames(elementsGroup, providerNameById, idToProviderId);
}
