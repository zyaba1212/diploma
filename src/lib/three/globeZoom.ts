import * as THREE from 'three';

type GlobeZoomDeltaParams = {
  currentZ: number;
  zoomDelta: number;
  zoomStep: number;
  minZ: number;
  maxZ: number;
};

/**
 * Canonical globe zoom math:
 * - zoomDelta > 0: zoom in (camera gets closer, z decreases)
 * - zoomDelta < 0: zoom out (camera gets farther, z increases)
 */
export function applyGlobeZoomDelta({
  currentZ,
  zoomDelta,
  zoomStep,
  minZ,
  maxZ,
}: GlobeZoomDeltaParams): number {
  const next = currentZ - zoomDelta * zoomStep;
  return THREE.MathUtils.clamp(next, minZ, maxZ);
}
