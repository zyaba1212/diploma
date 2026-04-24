// globeTrackballControls.ts — единая навигация глобуса (как на /global-network в EarthScene).

import * as THREE from 'three';

/** Порог смещения (px): меньше — считаем кликом, не драгом. */
export const GLOBE_LMB_DRAG_THRESHOLD_PX = 7;
const TRACKBALL_MAX_RAD_PER_EVENT = 0.55;

export type AttachGlobeTrackballParams = {
  domElement: HTMLElement;
  globeGroup: THREE.Group;
  /** Сфера земли (радиус из world scale) — для пересечения луча. */
  globeMesh: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  zoomMin?: number;
  zoomMax?: number;
  /** Когда false — жесты игнорируются (например не в режиме 3D). */
  isActive?: () => boolean;
  /** После wheel / pinch. */
  onZoomApplied?: (z: number) => void;
  /** После завершённого драга вращения (мышь или один палец). */
  onRotateDragEnd?: () => void;
  /**
   * ЛКМ без перетаскивания (как «короткий клик» в EarthScene).
   * Если не задан — не вызывается.
   */
  onShortPointerClick?: (e: PointerEvent) => void;
  /**
   * Вызывать в начале внешнего обработчика `click`, чтобы не срабатывать
   * после драга глобуса (sandbox: постановка узла по клику).
   */
  wheelFactor?: number;
  wheelFactorCtrl?: number;
};

export type AttachGlobeTrackballResult = {
  detach: () => void;
  /** Если true — это «клик» после драга глобуса, внешний click нужно пропустить. */
  consumeGlobeDragClickSuppression: () => boolean;
};

/**
 * Trackball + wheel + pinch + однопальцевый touch, как в EarthScene.
 * Слушатели: pointerdown на domElement; pointermove/up — window; touch на domElement.
 */
export function attachGlobeTrackballControls(params: AttachGlobeTrackballParams): AttachGlobeTrackballResult {
  const {
    domElement,
    globeGroup,
    globeMesh,
    camera,
    zoomMin = 1.2,
    zoomMax = 6,
    isActive = () => true,
    onZoomApplied,
    onRotateDragEnd,
    onShortPointerClick,
    wheelFactor = 0.0015,
    wheelFactorCtrl = 0.004,
  } = params;

  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  const sphereCenter = new THREE.Vector3();
  const sphereScale = new THREE.Vector3();
  const ocRay = new THREE.Vector3();
  const lastGlobeDir = new THREE.Vector3();
  const currGlobeDir = new THREE.Vector3();
  const rotAxis = new THREE.Vector3();

  let suppressNextClick = false;

  let dragging = false;
  let touchDragging = false;
  let pinchActive = false;
  let globePointerDown = false;
  let globeDragCommitted = false;
  let globeDownX = 0;
  let globeDownY = 0;
  let globeDragHasAnchor = false;
  let lastPinchDist = 0;

  const setCurrGlobeDirFromClient = (clientX: number, clientY: number): boolean => {
    const rect = domElement.getBoundingClientRect();
    mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    globeMesh.getWorldPosition(sphereCenter);
    globeMesh.getWorldScale(sphereScale);
    const radius = Math.max(sphereScale.x, sphereScale.y, sphereScale.z);
    const ray = raycaster.ray;
    ocRay.copy(ray.origin).sub(sphereCenter);
    const a = ray.direction.lengthSq();
    const b = 2 * ocRay.dot(ray.direction);
    const c = ocRay.dot(ocRay) - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    const sqrtD = Math.sqrt(disc);
    let t = (-b - sqrtD) / (2 * a);
    if (t < 1e-6) t = (-b + sqrtD) / (2 * a);
    if (t < 1e-6) return false;
    currGlobeDir.copy(ray.origin).addScaledVector(ray.direction, t).sub(sphereCenter).normalize();
    return true;
  };

  const applyTrackballAt = (clientX: number, clientY: number) => {
    if (!setCurrGlobeDirFromClient(clientX, clientY)) return;
    if (!globeDragHasAnchor) {
      lastGlobeDir.copy(currGlobeDir);
      globeDragHasAnchor = true;
      return;
    }
    rotAxis.crossVectors(lastGlobeDir, currGlobeDir);
    const asq = rotAxis.lengthSq();
    if (asq < 1e-16) return;
    const sinHalf = Math.sqrt(asq);
    let angle = Math.atan2(sinHalf, lastGlobeDir.dot(currGlobeDir));
    angle = Math.min(angle, TRACKBALL_MAX_RAD_PER_EVENT);
    rotAxis.multiplyScalar(1 / sinHalf);
    globeGroup.rotateOnWorldAxis(rotAxis, angle);
    globeGroup.quaternion.normalize();
    lastGlobeDir.copy(currGlobeDir);
  };

  const touchDistance = (touches: TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const applyWheelZoom = (e: WheelEvent) => {
    if (!isActive()) return;
    e.preventDefault();
    const factor = e.ctrlKey ? wheelFactorCtrl : wheelFactor;
    const next = THREE.MathUtils.clamp(camera.position.z + e.deltaY * factor, zoomMin, zoomMax);
    camera.position.z = next;
    onZoomApplied?.(next);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    if (!isActive()) return;
    suppressNextClick = false;
    globePointerDown = true;
    globeDragCommitted = false;
    globeDownX = e.clientX;
    globeDownY = e.clientY;
    dragging = false;
    globeDragHasAnchor = false;
    try {
      domElement.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const hadShortClick = globePointerDown && !globeDragCommitted && isActive();
    globePointerDown = false;
    const hadCommittedDrag = globeDragCommitted;
    globeDragCommitted = false;

    if (hadShortClick && onShortPointerClick) {
      onShortPointerClick(e);
    }

    if (dragging) {
      onRotateDragEnd?.();
    }
    if (hadCommittedDrag) {
      suppressNextClick = true;
    }
    dragging = false;
    globeDragHasAnchor = false;
    try {
      if (domElement.hasPointerCapture(e.pointerId)) {
        domElement.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  };

  const onLostPointerCapture = () => {
    globePointerDown = false;
    globeDragCommitted = false;
    if (dragging) {
      onRotateDragEnd?.();
      suppressNextClick = true;
    }
    dragging = false;
    globeDragHasAnchor = false;
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    globePointerDown = false;
    globeDragCommitted = false;
    if (dragging) {
      onRotateDragEnd?.();
      suppressNextClick = true;
    }
    dragging = false;
    globeDragHasAnchor = false;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (!isActive()) return;
    if (!globePointerDown) return;
    if (!globeDragCommitted) {
      const dx = e.clientX - globeDownX;
      const dy = e.clientY - globeDownY;
      if (dx * dx + dy * dy < GLOBE_LMB_DRAG_THRESHOLD_PX * GLOBE_LMB_DRAG_THRESHOLD_PX) return;
      globeDragCommitted = true;
      dragging = true;
      globeDragHasAnchor = false;
      if (setCurrGlobeDirFromClient(e.clientX, e.clientY)) {
        lastGlobeDir.copy(currGlobeDir);
        globeDragHasAnchor = true;
      }
    }
    if (!dragging) return;
    applyTrackballAt(e.clientX, e.clientY);
  };

  const onWheel = (e: WheelEvent) => {
    if (!isActive()) return;
    applyWheelZoom(e);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (!isActive()) return;
    if (e.touches.length === 2) {
      pinchActive = true;
      touchDragging = false;
      globeDragHasAnchor = false;
      lastPinchDist = touchDistance(e.touches);
    } else if (e.touches.length === 1) {
      pinchActive = false;
      touchDragging = true;
      globeDragHasAnchor = false;
      const t = e.touches[0];
      if (setCurrGlobeDirFromClient(t.clientX, t.clientY)) {
        lastGlobeDir.copy(currGlobeDir);
        globeDragHasAnchor = true;
      }
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!isActive()) return;
    e.preventDefault();
    if (e.touches.length === 2) {
      const d = touchDistance(e.touches);
      if (lastPinchDist > 0) {
        const scale = d / lastPinchDist;
        if (scale > 0 && Number.isFinite(scale)) {
          const next = THREE.MathUtils.clamp(camera.position.z / scale, zoomMin, zoomMax);
          camera.position.z = next;
          onZoomApplied?.(next);
        }
      }
      lastPinchDist = d;
    } else if (e.touches.length === 1 && touchDragging && !pinchActive) {
      const t = e.touches[0];
      applyTrackballAt(t.clientX, t.clientY);
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!isActive()) return;
    if (e.touches.length === 0) {
      if (touchDragging && !pinchActive) {
        onRotateDragEnd?.();
      }
      touchDragging = false;
      pinchActive = false;
      lastPinchDist = 0;
      globeDragHasAnchor = false;
    } else if (e.touches.length === 1) {
      pinchActive = false;
      touchDragging = true;
      lastPinchDist = 0;
      globeDragHasAnchor = false;
      const t = e.touches[0];
      if (setCurrGlobeDirFromClient(t.clientX, t.clientY)) {
        lastGlobeDir.copy(currGlobeDir);
        globeDragHasAnchor = true;
      }
    } else if (e.touches.length === 2) {
      lastPinchDist = touchDistance(e.touches);
    }
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('lostpointercapture', onLostPointerCapture);
  domElement.addEventListener('pointercancel', onPointerCancel);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('touchstart', onTouchStart, { passive: true });
  domElement.addEventListener('touchmove', onTouchMove, { passive: false });
  domElement.addEventListener('touchend', onTouchEnd, { passive: true });
  domElement.addEventListener('touchcancel', onTouchEnd, { passive: true });

  const detach = () => {
    domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointermove', onPointerMove);
    domElement.removeEventListener('lostpointercapture', onLostPointerCapture);
    domElement.removeEventListener('pointercancel', onPointerCancel);
    domElement.removeEventListener('wheel', onWheel);
    domElement.removeEventListener('touchstart', onTouchStart);
    domElement.removeEventListener('touchmove', onTouchMove);
    domElement.removeEventListener('touchend', onTouchEnd);
    domElement.removeEventListener('touchcancel', onTouchEnd);
  };

  const consumeGlobeDragClickSuppression = (): boolean => {
    if (!suppressNextClick) return false;
    suppressNextClick = false;
    return true;
  };

  return { detach, consumeGlobeDragClickSuppression };
}
