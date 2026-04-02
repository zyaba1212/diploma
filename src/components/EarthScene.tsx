'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getEarthMaterialMode, getEarthSphereSegments } from '@/lib/earthQuality';
import { disposeEarthTextures, loadEarthTextures } from '@/lib/loadEarthTextures';
import { EQUIPMENT_FACTORIES, NODE_VISUALS, TYPE_LABELS_RU, createSatelliteObject } from '@/lib/three/factories';
import { latLngToVec3, computeGlobeCenterLatLng, orientGlobeGroupCenterFromLatLng, makeTextSprite, makeTextMesh, disposeThreeObject } from '@/lib/three/utils';
import { WORLD_LABELS, LABEL_STYLE } from '@/lib/three/labels';
import { Panel } from './ui/Panel';
import { Button } from './ui/Button';
import { MapView } from './MapView';
import type { LatLng, NetworkResponseDTO, Scope } from '@/lib/types';
import type L from 'leaflet';

type ViewMode = 'GLOBE_3D' | 'MAP_2D';

/** Ранее использовался для авто-возврата в 3D; убран — ломал ручной режим «2D». */
const ZOOM_MIN = 1.2;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;

type NominatimSearchResult = {
  lat: string;
  lon: string;
  display_name?: string;
  type?: string;
};

type NominatimReverseResult = {
  display_name?: string;
  address?: Record<string, string>;
  type?: string;
  name?: string;
  lat?: string;
  lon?: string;
};

type UserLocation = LatLng & { accuracy?: number | null };


// WORLD_LABELS and LABEL_STYLE imported from '@/lib/three/labels'

function formatLocationLabel(data: NominatimReverseResult | null): string {
  const addr = data?.address ?? {};
  const city = addr.city || addr.town || addr.village || addr.hamlet;
  const region = addr.state || addr.region;
  const country = addr.country;
  const parts = [city, region, country].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (data?.display_name) return data.display_name;
  return '—';
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (json?.error) msg = json.error;
      throw new Error(msg);
    }
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(t);
  }
}

function EarthSceneComponent() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('GLOBE_3D');
  const [zoom, setZoom] = useState<number>(2.5);
  const [mapZoom, setMapZoom] = useState<number>(2);
  const scope: Scope = 'GLOBAL';
  const [network, setNetwork] = useState<NetworkResponseDTO | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [reverseCenter, setReverseCenter] = useState<LatLng | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>('—');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [userLocationLabel, setUserLocationLabel] = useState<string>('—');
  const [userLocationLoading, setUserLocationLoading] = useState(false);
  const [userLocationError, setUserLocationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<NominatimSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDropdownVisible, setSearchDropdownVisible] = useState(false);
  const [targetCenter, setTargetCenter] = useState<LatLng | null>(null);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [hoveredElement, setHoveredElement] = useState<{
    x: number; y: number;
    elName: string; elType: string; providerName: string;
    metadata: Record<string, unknown> | null; scope: string;
  } | null>(null);

  const globeGroup = useMemo(() => new THREE.Group(), []);
  const networkGroup = useMemo(() => new THREE.Group(), []);

  const viewModeRef = useRef<ViewMode>(viewMode);
  const prevViewModeRef = useRef<ViewMode>(viewMode);
  const zoomRef = useRef<number>(zoom);
  const leafletMapRef = useRef<L.Map | null>(null);
  const savedCenterRef = useRef<{ lat: number; lng: number }>({ lat: 30, lng: 0 });

  const nodeLabelCandidatesRef = useRef<
    Array<{ sprite: THREE.Object3D; latRad: number; lngRad: number; sinLat: number; cosLat: number }>
  >([]);
  const geoLabelCandidatesRef = useRef<
    Array<{ sprite: THREE.Sprite; latRad: number; lngRad: number; sinLat: number; cosLat: number }>
  >([]);
  const geoLabelSpritesRef = useRef<THREE.Sprite[]>([]);
  const geoLabelFetchSeqRef = useRef<number>(0);
  const lastGeoLabelKeyRef = useRef<string | null>(null);
  const geoLabelInFlightRef = useRef<boolean>(false);
  const GEO_LABEL_FETCH_MIN_MS = 1500;

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    if (prev === 'MAP_2D' && viewMode === 'GLOBE_3D') {
      const map = leafletMapRef.current;
      if (map) {
        const c = map.getCenter();
        savedCenterRef.current = { lat: c.lat, lng: c.lng };
        orientGlobeGroupCenterFromLatLng(globeGroup, c.lat, c.lng);
        return;
      }
      const fallback = targetCenter ?? savedCenterRef.current;
      orientGlobeGroupCenterFromLatLng(globeGroup, fallback.lat, fallback.lng);
    }
  }, [viewMode, globeGroup, targetCenter]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (viewMode !== 'GLOBE_3D') {
      for (const c of nodeLabelCandidatesRef.current) c.sprite.visible = false;
      for (const c of geoLabelCandidatesRef.current) c.sprite.visible = false;
    }
  }, [viewMode]);

  const setMapCenterFromGlobe = useCallback(() => {
    const center = computeGlobeCenterLatLng(globeGroup) ?? { lat: 0, lng: 0 };
    savedCenterRef.current = center;
    setTargetCenter(center);
    setReverseCenter(center);
  }, [globeGroup]);

  const setZoomByDelta = (delta: number) => {
    const c = cameraRef.current;
    if (!c) return;
    const next = THREE.MathUtils.clamp(c.position.z + delta, ZOOM_MIN, ZOOM_MAX);
    c.position.z = next;
    setZoom(next);
  };

  const MAP_ZOOM_MIN = 2;
  const MAP_ZOOM_MAX = 19;
  const setMapZoomByDelta = (delta: number) => {
    const map = leafletMapRef.current;
    if (!map) return;
    const next = THREE.MathUtils.clamp(map.getZoom() + delta, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
    if (Math.abs(next - map.getZoom()) < 1e-6) return;
    map.setZoom(next);
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a2746);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    camera.position.set(0, 0, 3);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.localClippingEnabled = true;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const sphereSegs = getEarthSphereSegments();
    const materialMode = getEarthMaterialMode();

    const hemi = new THREE.HemisphereLight(0x6b8cff, 0x081022, 0.72);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 3.8);
    sun.position.set(4.5, 2.2, 5);
    scene.add(sun);

    if (materialMode === 'standard') {
      hemi.intensity = 0.78;
      ambient.intensity = 0.52;
      sun.intensity = 4.05;
    }

    // stars
    const starsGeo = new THREE.BufferGeometry();
    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 120 + Math.random() * 600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(
      starsGeo,
      new THREE.PointsMaterial({ size: 0.6, sizeAttenuation: true, color: 0x9fb3ff }),
    );
    scene.add(stars);

    const globeGeo = new THREE.SphereGeometry(1, sphereSegs, sphereSegs);
    const fallbackMat = new THREE.MeshPhongMaterial({
      color: 0x24517e,
      emissive: 0x144d7a,
      shininess: 10,
      specular: 0x2f3b62,
    });
    const globe: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial | THREE.MeshStandardMaterial> =
      new THREE.Mesh(globeGeo, fallbackMat);
    globeGroup.add(globe);

    const cloudGeo = new THREE.SphereGeometry(1.012, sphereSegs, sphereSegs);
    const cloudPlaceholder = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const clouds: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial | THREE.MeshStandardMaterial> =
      new THREE.Mesh(cloudGeo, cloudPlaceholder);
    globeGroup.add(clouds);

    globeGroup.add(networkGroup);
    scene.add(globeGroup);

    orientGlobeGroupCenterFromLatLng(globeGroup, savedCenterRef.current.lat, savedCenterRef.current.lng);

    let cancelled = false;

    loadEarthTextures(renderer).then((set) => {
      if (!set) return;
      if (cancelled) {
        disposeEarthTextures(set);
        return;
      }

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
    });

    const onResize = () => {
      const m = mountRef.current;
      const r = rendererRef.current;
      const c = cameraRef.current;
      if (!m || !r || !c) return;
      c.aspect = m.clientWidth / m.clientHeight;
      c.updateProjectionMatrix();
      r.setSize(m.clientWidth, m.clientHeight);
    };
    window.addEventListener('resize', onResize);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let touchDragging = false;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let pinchActive = false;
    let lastPinchDist = 0;

    const touchDistance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (viewModeRef.current !== 'GLOBE_3D') return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      dragging = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (viewModeRef.current !== 'GLOBE_3D') return;
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      globeGroup.rotation.y += dx * 0.005;
      globeGroup.rotation.x += dy * 0.005;
      globeGroup.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, globeGroup.rotation.x));
    };
    const onWheel = (e: WheelEvent) => {
      if (viewModeRef.current !== 'GLOBE_3D') return;
      e.preventDefault();
      const c = cameraRef.current;
      if (!c) return;
      const factor = e.ctrlKey ? 0.004 : 0.0015;
      const next = THREE.MathUtils.clamp(c.position.z + e.deltaY * factor, ZOOM_MIN, ZOOM_MAX);
      c.position.z = next;
      setZoom(next);
    };

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.015 };
    const mouseNDC = new THREE.Vector2();

    const onTouchStart = (e: TouchEvent) => {
      if (viewModeRef.current !== 'GLOBE_3D') return;
      if (e.touches.length === 2) {
        pinchActive = true;
        touchDragging = false;
        lastPinchDist = touchDistance(e.touches);
      } else if (e.touches.length === 1) {
        pinchActive = false;
        touchDragging = true;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (viewModeRef.current !== 'GLOBE_3D') return;
      e.preventDefault();
      if (e.touches.length === 2) {
        const d = touchDistance(e.touches);
        if (lastPinchDist > 0) {
          const scale = d / lastPinchDist;
          const c = cameraRef.current;
          if (c && scale > 0 && Number.isFinite(scale)) {
            const next = THREE.MathUtils.clamp(c.position.z / scale, ZOOM_MIN, ZOOM_MAX);
            c.position.z = next;
            setZoom(next);
          }
        }
        lastPinchDist = d;
      } else if (e.touches.length === 1 && touchDragging && !pinchActive) {
        const t = e.touches[0];
        const dx = t.clientX - lastTouchX;
        const dy = t.clientY - lastTouchY;
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;
        globeGroup.rotation.y += dx * 0.005;
        globeGroup.rotation.x += dy * 0.005;
        globeGroup.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, globeGroup.rotation.x));
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (viewModeRef.current !== 'GLOBE_3D') return;
      if (e.touches.length === 0) {
        touchDragging = false;
        pinchActive = false;
        lastPinchDist = 0;
      } else if (e.touches.length === 1) {
        pinchActive = false;
        touchDragging = true;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        lastPinchDist = 0;
      } else if (e.touches.length === 2) {
        lastPinchDist = touchDistance(e.touches);
      }
    };

    const onHoverMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (viewModeRef.current !== 'GLOBE_3D') { setHoveredElement(null); return; }
      if (dragging) { setHoveredElement(null); return; }
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const cam = cameraRef.current;
      if (!cam) return;
      raycaster.setFromCamera(mouseNDC, cam);
      const hits = raycaster.intersectObjects(networkGroup.children, true);
      let found: THREE.Object3D | null = null;
      for (const h of hits) {
        let obj: THREE.Object3D | null = h.object;
        while (obj && !obj.userData?.elType) obj = obj.parent;
        if (obj?.userData?.elType) { found = obj; break; }
      }
      if (found) {
        const ud = found.userData;
        setHoveredElement({
          x: e.clientX, y: e.clientY,
          elName: ud.elName ?? '', elType: ud.elType ?? '',
          providerName: ud.providerName ?? '',
          metadata: ud.metadata ?? null, scope: ud.scope ?? '',
        });
      } else {
        setHoveredElement(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointermove', onHoverMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: true });
    renderer.domElement.addEventListener('touchcancel', onTouchEnd, { passive: true });

    const frontVec = new THREE.Vector3(0, 0, -1);
    const localVec = new THREE.Vector3();
    const invQuat = new THREE.Quaternion();

    const animate = () => {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      if (!r || !s || !c) return;
      frameRef.current = requestAnimationFrame(animate);

      // Local 3D labels: показываем только объекты рядом с текущим "центром" глобуса (front-face only).
      if (
        viewModeRef.current === 'GLOBE_3D' &&
        (nodeLabelCandidatesRef.current.length > 0 || geoLabelCandidatesRef.current.length > 0)
      ) {
        const z = zoomRef.current;
        const labelRadiusDeg = z < 2.0 ? 16 : z < 3.0 ? 20 : 26;
        const cosRadius = Math.cos((labelRadiusDeg * Math.PI) / 180);

        frontVec.set(0, 0, -1);
        localVec.copy(frontVec).applyQuaternion(invQuat.copy(globeGroup.quaternion).invert());

        // Инвертируем rot, чтобы получить точку на "неповёрнутой" Земле, которая смотрит в камеру.
        const y = Math.max(-1, Math.min(1, localVec.y));
        const centerLatRad = Math.asin(y); // y = sin(lat) в нашей системе координат
        const centerLngRad = Math.atan2(localVec.z, -localVec.x) - Math.PI;
        const sinCenter = Math.sin(centerLatRad);
        const cosCenter = Math.cos(centerLatRad);

        const updateCandidates = (cands: typeof nodeLabelCandidatesRef.current) => {
          for (const cand of cands) {
            const cosd =
              sinCenter * cand.sinLat +
              cosCenter * cand.cosLat * Math.cos(centerLngRad - cand.lngRad);
            // cosd < 0 => back hemisphere. Don't show anything there.
            cand.sprite.visible = cosd >= cosRadius && cosd > 0;
          }
        };
        updateCandidates(nodeLabelCandidatesRef.current);
        updateCandidates(geoLabelCandidatesRef.current);
      }
      r.render(s, c);
    };
    animate();

    return () => {
      cancelled = true;

      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('pointermove', onHoverMove);
      renderer.domElement.removeEventListener('touchstart', onTouchStart);
      renderer.domElement.removeEventListener('touchmove', onTouchMove);
      renderer.domElement.removeEventListener('touchend', onTouchEnd);
      renderer.domElement.removeEventListener('touchcancel', onTouchEnd);

      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;

      globeGeo.dispose();
      cloudGeo.dispose();
      if (globe.material instanceof THREE.Material) globe.material.dispose();
      if (clouds.material instanceof THREE.Material) clouds.material.dispose();

      scene.clear();
      renderer.dispose();
      mount.removeChild(renderer.domElement);

      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, [globeGroup, networkGroup]);

  useEffect(() => {
    if (viewMode !== 'MAP_2D') {
      setReverseCenter(null);
      setLocationLabel('—');
      setLocationError(null);
      setLocationLoading(false);
      setUserLocation(null);
      setUserLocationLabel('—');
      setUserLocationError(null);
      setUserLocationLoading(false);
      setSearchQuery('');
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      setSearchDropdownVisible(false);
      setTargetCenter(null);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'MAP_2D' || !reverseCenter) return;
    let cancelled = false;
    // Make the UI feel responsive: show "Определяем локацию…" immediately,
    // while the actual reverse request is still debounced.
    setLocationLoading(true);
    setLocationError(null);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await fetchJsonWithTimeout<NominatimReverseResult>(
            `/api/geocode/reverse?lat=${reverseCenter.lat}&lng=${reverseCenter.lng}`,
            9000,
          );
          if (cancelled) return;
          setLocationLabel(formatLocationLabel(data));
        } catch (e: unknown) {
          if (cancelled) return;
          setLocationError(e instanceof Error ? e.message : 'reverse geocode failed');
          setLocationLabel('—');
        } finally {
          if (!cancelled) setLocationLoading(false);
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [reverseCenter, viewMode]);

  useEffect(() => {
    if (viewMode !== 'MAP_2D') return;
    if (!navigator.geolocation) {
      setUserLocationError('Geolocation is not supported by this browser');
      setUserLocationLoading(false);
      return;
    }

    let cancelled = false;

    setUserLocationLoading(true);
    setUserLocationError(null);
    setUserLocationLabel('—');
    setUserLocation(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null;

        setUserLocation({ lat, lng, accuracy });

        void (async () => {
          try {
            const data = await fetchJsonWithTimeout<NominatimReverseResult>(
              `/api/geocode/reverse?lat=${lat}&lng=${lng}`,
              9000,
            );
            if (cancelled) return;
            setUserLocationLabel(formatLocationLabel(data));
          } catch (e: unknown) {
            if (cancelled) return;
            setUserLocationError(e instanceof Error ? e.message : 'reverse geocode failed');
            setUserLocationLabel('—');
          } finally {
            if (!cancelled) setUserLocationLoading(false);
          }
        })();
      },
      (err) => {
        if (cancelled) return;
        const msg = err.message || '';
        const friendly = msg.includes('permissions policy') || msg.includes('denied')
          ? 'Геолокация недоступна (требуется HTTPS или разрешение браузера)'
          : msg || 'Геолокация недоступна';
        setUserLocationError(friendly);
        setUserLocationLabel('—');
        setUserLocationLoading(false);
        setUserLocation(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );

    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'MAP_2D') return;
    if (!searchDropdownVisible) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      setSearchDropdownVisible(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    setSearchDropdownVisible(true);

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await fetchJsonWithTimeout<NominatimSearchResult[]>(
            `/api/geocode/search?q=${encodeURIComponent(q)}`,
            9000,
          );
          if (cancelled) return;
          setSearchResults(Array.isArray(data) ? data : []);
        } catch (e: unknown) {
          if (cancelled) return;
          setSearchError(e instanceof Error ? e.message : 'search failed');
          setSearchResults([]);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setSearchLoading(false);
    };
  }, [searchQuery, viewMode, searchDropdownVisible]);

  const handleCenterChanged = useCallback((c: LatLng) => {
    savedCenterRef.current = { lat: c.lat, lng: c.lng };
    setReverseCenter((prev) => {
      if (
        prev &&
        Math.abs(prev.lat - c.lat) < 1e-6 &&
        Math.abs(prev.lng - c.lng) < 1e-6
      ) {
        return prev;
      }
      return c;
    });
  }, []);

  const handleSelectSearchResult = useCallback((r: NominatimSearchResult) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setTargetCenter({ lat, lng });
    setReverseCenter((prev) => {
      if (prev && Math.abs(prev.lat - lat) < 1e-6 && Math.abs(prev.lng - lng) < 1e-6) return prev;
      return { lat, lng };
    });
    setSearchResults([]);
    setSearchError(null);
    setSearchLoading(false);
    setSearchDropdownVisible(false);
    setSearchQuery(r.display_name ?? '');

    if (viewMode === 'MAP_2D') {
      setMapZoom(12);
      leafletMapRef.current?.setView([lat, lng], 12);
    }
  }, [viewMode]);

  useEffect(() => {
    let cancelled = false;
    setNetworkError(null);
    setNetwork(null);

    const url = new URL('/api/network', window.location.origin);
    url.searchParams.set('scope', scope);
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as NetworkResponseDTO;
      })
      .then((data) => {
        if (cancelled) return;
        setNetwork(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setNetworkError(e instanceof Error ? e.message : 'Unknown error');
      });

    return () => {
      cancelled = true;
    };
  }, [scope]);

  useEffect(() => {
    // Rebuild 3D network visualization (cables + nodes + local labels).
    const disposedMaterials = new WeakSet<THREE.Material>();
    const disposedTextures = new WeakSet<THREE.Texture>();
    for (const child of networkGroup.children.slice()) disposeThreeObject(child, disposedMaterials, disposedTextures);
    networkGroup.clear();
    nodeLabelCandidatesRef.current = [];

    if (!network) return;

    const DEG2RAD = Math.PI / 180;

    // Clipping plane hides cables on the far side of the globe (back-face culling).
    const cableClipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.15);
    const cableClip = [cableClipPlane];

    const cableMatFiberSub = new THREE.LineBasicMaterial({ color: 0x3a7bd5, transparent: true, opacity: 0.9, clippingPlanes: cableClip });
    const cableMatCopperSub = new THREE.LineBasicMaterial({ color: 0xd4a54a, transparent: true, opacity: 0.9, clippingPlanes: cableClip });
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

    const nodeVisuals = NODE_VISUALS;

    for (const el of network.elements) {
      const type = el.type;

      // Cables (path)
      const isSubFiber = type === 'CABLE_FIBER';
      const isSubCopper = type === 'CABLE_COPPER';
      const isUndFiber = type === 'CABLE_UNDERGROUND_FIBER';
      const isUndCopper = type === 'CABLE_UNDERGROUND_COPPER';
      const isCable = (isSubFiber || isSubCopper || isUndFiber || isUndCopper) && Array.isArray(el.path);

      if (isCable && el.path) {
        const radius = isUndFiber || isUndCopper ? 1.002 : 1.001;
        let mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
        if (isUndFiber) mat = cableMatFiberUnd;
        else if (isUndCopper) mat = cableMatCopperUnd;
        else if (isSubFiber) mat = cableMatFiberSub;
        else mat = cableMatCopperSub;

        const pts = el.path
          .map((p) => latLngToVec3(p.lat, p.lng, radius))
          .filter((v): v is THREE.Vector3 => Boolean(v));
        if (pts.length < 2) continue;

        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, mat);
        if (mat instanceof THREE.LineDashedMaterial) {
          line.computeLineDistances();
        }
        line.frustumCulled = false;
        const providerName = network.providers.find((p) => p.id === el.providerId)?.name ?? '';
        line.userData = { elName: el.name, elType: type, providerName, metadata: el.metadata, scope: el.scope };
        networkGroup.add(line);
        continue;
      }

      // Nodes (lat/lng)
      if (typeof el.lat !== 'number' || typeof el.lng !== 'number') continue;
      const visual = nodeVisuals[type];
      if (!visual) continue;

      let altitudeKm = 0;
      if (typeof el.altitude === 'number' && Number.isFinite(el.altitude)) altitudeKm = el.altitude;
      else if (type === 'SATELLITE') altitudeKm = 550;
      const nodeR = type === 'SATELLITE' ? 1.0 + altitudeKm / 6371 : 1.012 + (visual.size - 0.01) * 0.9;

      const pos = latLngToVec3(el.lat, el.lng, nodeR);
      if (!pos) continue;

      const normal = pos.clone().normalize();
      const providerName = network.providers.find((p) => p.id === el.providerId)?.name ?? '';
      const elUserData = { elName: el.name, elType: type, providerName, metadata: el.metadata, scope: el.scope };
      if (type === 'SATELLITE') {
        const satelliteObj = createSatelliteObject(visual.size, visual.color, visual.emissive);
        satelliteObj.position.copy(pos);
        satelliteObj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        satelliteObj.userData = elUserData;
        networkGroup.add(satelliteObj);
      } else {
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
        networkGroup.add(marker);
      }

      // Local labels: видимость обновляется в animate() по текущему центру глобуса.
      const labelText = el.name && el.name.trim().length > 0 ? el.name.trim() : type;
      const sprite = makeTextSprite(labelText, {
        background: 'rgba(0,0,0,0.55)',
        color: '#eaf2ff',
        fontSize: 18,
      });
      sprite.position.copy(pos);
      sprite.position.add(normal.multiplyScalar(0.03 + visual.size * 0.4));
      sprite.visible = false;
      networkGroup.add(sprite);

      const latRad = el.lat * DEG2RAD;
      const lngRad = el.lng * DEG2RAD;
      nodeLabelCandidatesRef.current.push({
        sprite,
        latRad,
        lngRad,
        sinLat: Math.sin(latRad),
        cosLat: Math.cos(latRad),
      });
    }

    for (const wl of WORLD_LABELS) {
      const style = LABEL_STYLE[wl.kind] ?? LABEL_STYLE.country;
      const labelR = wl.kind === 'water' ? 1.001 : 1.018;
      const pos = latLngToVec3(wl.lat, wl.lng, labelR);
      if (!pos) continue;
      const labelColor = wl.kind === 'water' ? '#80e0ff' : wl.kind === 'city' ? '#b0d4ff' : '#ffffff';
      const mesh = makeTextMesh(wl.text, pos, {
        color: labelColor,
        fontSize: wl.fontSize,
        kind: wl.kind,
      });
      mesh.visible = false;
      networkGroup.add(mesh);

      const latRad = wl.lat * DEG2RAD;
      const lngRad = wl.lng * DEG2RAD;
      nodeLabelCandidatesRef.current.push({
        sprite: mesh,
        latRad,
        lngRad,
        sinLat: Math.sin(latRad),
        cosLat: Math.cos(latRad),
      });
    }
  }, [network, networkGroup]);

  useEffect(() => {
    // Dynamic 3D labels for country/city/water near current globe center.
    // Reverse geocoding is routed via backend proxy: `/api/geocode/reverse`.
    if (viewMode !== 'GLOBE_3D') return;
    if (zoomRef.current > 4.2) return;

    let cancelled = false;
    let lastFetchAt = 0;

    const normalizeLng = (lng: number) => {
      let v = lng;
      while (v > 180) v -= 360;
      while (v < -180) v += 360;
      return v;
    };

    const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));

    const shorten = (s: string, maxLen: number) => (s.length > maxLen ? `${s.slice(0, maxLen - 3)}...` : s);

    const tick = async () => {
      if (cancelled) return;
      if (geoLabelInFlightRef.current) return;

      const center = computeGlobeCenterLatLng(globeGroup);
      if (!center) return;

      const z = zoomRef.current;
      const key = `${Math.round(center.lat * 0.8)}:${Math.round(center.lng * 0.8)}:${Math.round(z * 2) / 2}`;
      if (lastGeoLabelKeyRef.current === key) return;

      const now = Date.now();
      if (now - lastFetchAt < GEO_LABEL_FETCH_MIN_MS) return;

      geoLabelInFlightRef.current = true;
      lastGeoLabelKeyRef.current = key;
      lastFetchAt = now;

      try {
        const seq = ++geoLabelFetchSeqRef.current;

        const offsets = [
          { lat: center.lat, lng: center.lng }, // country/city
          { lat: clampLat(center.lat + 1.0), lng: normalizeLng(center.lng) }, // maybe water north-ish
          { lat: clampLat(center.lat), lng: normalizeLng(center.lng + 1.0) }, // maybe water east-ish
        ];

        const res = await Promise.allSettled(
          offsets.map((o) =>
            fetchJsonWithTimeout<NominatimReverseResult>(
              `/api/geocode/reverse?lat=${o.lat}&lng=${o.lng}`,
              9000,
            ),
          ),
        );

        if (cancelled) return;
        if (seq !== geoLabelFetchSeqRef.current) return;

        const d0 = res[0].status === 'fulfilled' ? res[0].value : null;
        const d1 = res[1].status === 'fulfilled' ? res[1].value : null;
        const d2 = res[2].status === 'fulfilled' ? res[2].value : null;

        // Cleanup previous geo labels.
        if (geoLabelSpritesRef.current.length > 0) {
          const disposedMaterials = new WeakSet<THREE.Material>();
          const disposedTextures = new WeakSet<THREE.Texture>();
          for (const s of geoLabelSpritesRef.current) {
            networkGroup.remove(s);
            disposeThreeObject(s, disposedMaterials, disposedTextures);
          }
          geoLabelSpritesRef.current = [];
        }
        geoLabelCandidatesRef.current = [];

        const addr0 = (d0?.address && typeof d0.address === 'object' ? d0.address : {}) as Record<string, string>;
        const country = addr0.country || '';
        const city =
          addr0.city ||
          addr0.town ||
          addr0.village ||
          addr0.hamlet ||
          addr0.municipality ||
          addr0.county ||
          '';
        const display0 = typeof d0?.display_name === 'string' ? d0.display_name : '';

        const isWaterFeature = (payload: NominatimReverseResult | null) => {
          if (!payload) return false;
          const type = (payload.type ?? '').toLowerCase();
          const display = (payload.display_name ?? '').toLowerCase();
          const addr = payload.address ? Object.values(payload.address).join(' ').toLowerCase() : '';
          const hay = `${type} ${display} ${addr}`;
          const waterKeywords = [
            'sea',
            'ocean',
            'lake',
            'river',
            'bay',
            'gulf',
            'strait',
            'channel',
            'waterway',
            'harbor',
            'harbour',
            'sound',
          ];
          return waterKeywords.some((k) => hay.includes(k));
        };

        const waterPayload = isWaterFeature(d1) ? d1 : isWaterFeature(d2) ? d2 : null;
        const waterTextBase =
          typeof waterPayload?.display_name === 'string'
            ? waterPayload.display_name
            : typeof waterPayload?.name === 'string'
              ? waterPayload.name
              : '';
        const waterLabel = waterTextBase ? shorten(waterTextBase, 26) : '';

        const labelRadius = 1.028;
        const addGeoSprite = (text: string, lat: number, lng: number, fontSize: number) => {
          if (!text || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
          const pos = latLngToVec3(lat, lng, labelRadius);
          if (!pos) return;

          const normal = pos.clone().normalize();
          const sprite = makeTextSprite(text.trim(), {
            background: 'rgba(0,0,0,0.55)',
            color: '#f0f8ff',
            fontSize,
          });
          sprite.position.copy(pos);
          sprite.position.add(normal.multiplyScalar(0.045));
          sprite.visible = false;

          networkGroup.add(sprite);
          geoLabelSpritesRef.current.push(sprite);

          const DEG2RAD = Math.PI / 180;
          const latRad = lat * DEG2RAD;
          const lngRad = lng * DEG2RAD;
          geoLabelCandidatesRef.current.push({
            sprite,
            latRad,
            lngRad,
            sinLat: Math.sin(latRad),
            cosLat: Math.cos(latRad),
          });
        };

        if (country) addGeoSprite(country, center.lat, center.lng, 22);
        if (city) addGeoSprite(city, center.lat, center.lng, 20);
        else if (display0) addGeoSprite(shorten(display0, 22), center.lat, center.lng, 18);

        if (waterPayload && waterLabel) {
          const latW = waterPayload.lat ? Number(waterPayload.lat) : offsets[1].lat;
          const lngW = waterPayload.lon ? Number(waterPayload.lon) : offsets[1].lng;
          if (Number.isFinite(latW) && Number.isFinite(lngW)) addGeoSprite(waterLabel, latW, lngW, 16);
        }
      } finally {
        geoLabelInFlightRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [viewMode, globeGroup, networkGroup]);

  return (
    <>
      <div
        ref={mountRef}
        style={{
          position: 'absolute',
          inset: 0,
          height: '100%',
          width: '100%',
          zIndex: 0,
          pointerEvents: viewMode === 'MAP_2D' ? 'none' : 'auto',
        }}
      />

      <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 12, zIndex: 10 }}>
        <Panel title="Режим">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              onClick={() => {
                const map = leafletMapRef.current;
                const center = map
                  ? { lat: map.getCenter().lat, lng: map.getCenter().lng }
                  : targetCenter ?? savedCenterRef.current;
                savedCenterRef.current = center;
                orientGlobeGroupCenterFromLatLng(globeGroup, center.lat, center.lng);
                setViewMode('GLOBE_3D');
              }}
            >
              3D
            </Button>
            <Button
              onClick={() => {
                setMapCenterFromGlobe();
                setViewMode('MAP_2D');
              }}
            >
              2D
            </Button>
            <Button
              onClick={() => {
                if (viewMode === 'MAP_2D') setMapZoomByDelta(+1);
                else setZoomByDelta(-ZOOM_STEP); // closer
              }}
              disabled={viewMode === 'MAP_2D' ? mapZoom >= MAP_ZOOM_MAX - 1e-6 : zoom <= ZOOM_MIN + 1e-6}
              title="Ближе"
            >
              +
            </Button>
            <Button
              onClick={() => {
                if (viewMode === 'MAP_2D') setMapZoomByDelta(-1);
                else setZoomByDelta(ZOOM_STEP); // farther
              }}
              disabled={viewMode === 'MAP_2D' ? mapZoom <= MAP_ZOOM_MIN + 1e-6 : zoom >= ZOOM_MAX - 1e-6}
              title="Дальше"
            >
              −
            </Button>
            <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--muted)' }}>
              {viewMode === 'MAP_2D' ? mapZoom.toFixed(0) : zoom.toFixed(2)}
            </span>
          </div>
        </Panel>
        <Panel title="Данные">
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {networkError ? (
              <span style={{ color: 'var(--danger)' }}>network error: {networkError}</span>
            ) : network ? (
              <span>
                providers: {network.providers.length}, elements: {network.elements.length}
              </span>
            ) : (
              <span>loading…</span>
            )}
          </div>
        </Panel>
      </div>

      {/* Hover tooltip for network elements */}
      {hoveredElement && viewMode === 'GLOBE_3D' && (
        <div
          style={{
            position: 'fixed',
            left: hoveredElement.x + 14,
            top: hoveredElement.y + 14,
            zIndex: 50,
            pointerEvents: 'none',
            background: 'rgba(10,20,40,0.92)',
            border: '1px solid rgba(120,160,255,0.35)',
            borderRadius: 10,
            padding: '10px 14px',
            maxWidth: 340,
            backdropFilter: 'blur(8px)',
            fontSize: 13,
            color: '#eaf2ff',
            lineHeight: 1.5,
          }}
        >
          {hoveredElement.elName && (
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>{hoveredElement.elName}</div>
          )}
          <div style={{ color: 'rgba(180,210,255,0.85)', marginBottom: 2 }}>
            {TYPE_LABELS_RU[hoveredElement.elType] ?? hoveredElement.elType}
          </div>
          {hoveredElement.providerName && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: '#8ab4f8' }}>Провайдер:</span> {hoveredElement.providerName}
            </div>
          )}
          {hoveredElement.metadata?.countries ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: '#8ab4f8' }}>Страны:</span>{' '}
              {Array.isArray(hoveredElement.metadata.countries)
                ? (hoveredElement.metadata.countries as string[]).join(', ')
                : String(hoveredElement.metadata.countries)}
            </div>
          ) : null}
          {hoveredElement.metadata?.year ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: '#8ab4f8' }}>Год:</span> {String(hoveredElement.metadata.year)}
            </div>
          ) : null}
          {hoveredElement.metadata?.description ? (
            <div style={{ marginBottom: 2, fontStyle: 'italic', color: 'rgba(200,220,255,0.7)' }}>
              {String(hoveredElement.metadata.description)}
            </div>
          ) : null}
          {hoveredElement.metadata?.operator ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: '#8ab4f8' }}>Оператор:</span> {String(hoveredElement.metadata.operator)}
            </div>
          ) : null}
          <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(140,170,220,0.7)' }}>
            {hoveredElement.scope === 'GLOBAL' ? 'Глобальный' : hoveredElement.scope === 'LOCAL' ? 'Локальный' : ''}
          </div>
        </div>
      )}

      {/* Legend overlay (3D mode only) */}
      {viewMode === 'GLOBE_3D' && (
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            zIndex: 10,
            background: 'rgba(10,20,40,0.82)',
            border: '1px solid rgba(120,160,255,0.2)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 11,
            color: '#c8daf0',
            lineHeight: 1.7,
            backdropFilter: 'blur(6px)',
            maxWidth: 210,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12, color: '#eaf2ff' }}>Легенда</div>
          {/* Cable types */}
          {[
            { color: '#3a7bd5', label: 'Подводный оптовол. кабель' },
            { color: '#d4a54a', label: 'Подводный медный кабель' },
            { color: '#00e676', label: 'Подземный оптовол. кабель', dashed: true },
            { color: '#ff7043', label: 'Подземный медный кабель', dashed: true },
          ].map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 18, height: 0, borderTop: `2px ${item.dashed ? 'dashed' : 'solid'} ${item.color}`, flexShrink: 0 }} />
              <span>{item.label}</span>
            </div>
          ))}
          <div style={{ marginTop: 4, borderTop: '1px solid rgba(120,160,255,0.12)', paddingTop: 4 }} />
          {/* Equipment types with shape indicators */}
          {[
            { color: '#7aa2ff', label: 'Провайдер', shape: '◎' },
            { color: '#3ddc97', label: 'Сервер / Дата-центр', shape: '▮' },
            { color: '#f6c177', label: 'Коммутатор', shape: '▬' },
            { color: '#e6a7ff', label: 'Мультиплексор', shape: '⊛' },
            { color: '#b36cff', label: 'Демультиплексор', shape: '⊛' },
            { color: '#ffc3a0', label: 'Базовая станция', shape: '▲' },
            { color: '#7df1ff', label: 'Регенератор', shape: '◻' },
            { color: '#9fe7ff', label: 'Спутник', shape: '✦' },
            { color: '#00e5ff', label: 'Mesh-ретранслятор', shape: '◈' },
            { color: '#ffd740', label: 'SMS-шлюз (2G)', shape: '◇' },
            { color: '#b388ff', label: 'VSAT-терминал', shape: '⬡' },
            { color: '#69f0ae', label: 'Офлайн-очередь', shape: '▣' },
          ].map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: item.color, fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}>{item.shape}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {viewMode === 'MAP_2D' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.25)',
            zIndex: 4,
          }}
        >
          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            <MapView
              network={network}
              center={targetCenter}
              initialCenter={targetCenter}
              userLocation={userLocation}
              onCenterChanged={handleCenterChanged}
              onMapReady={(m) => {
                leafletMapRef.current = m;
                setMapLoadError(null);
              }}
              onZoomChanged={(z) => setMapZoom(z)}
              onError={(msg) => setMapLoadError(msg)}
            />
            {mapLoadError && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.6)', zIndex: 2,
              }}>
                <div style={{
                  background: 'var(--panel)', padding: 24, borderRadius: 12,
                  maxWidth: 400, textAlign: 'center',
                }}>
                  <p style={{ color: 'var(--danger)', marginBottom: 8 }}>Не удалось загрузить карту</p>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{mapLoadError}</p>
                  <button
                    type="button"
                    onClick={() => { setMapLoadError(null); setViewMode('MAP_2D'); }}
                    style={{
                      marginTop: 12, padding: '6px 16px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--panel)',
                      color: 'var(--text)', cursor: 'pointer',
                    }}
                  >
                    Повторить
                  </button>
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              position: 'absolute',
              left: 12,
              top: 64,
              zIndex: 12,
              width: 360,
              maxWidth: 'calc(100vw - 24px)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              {locationLoading ? 'Определяем локацию…' : locationError ? (
                <span style={{ color: 'var(--danger)' }}>{locationError}</span>
              ) : (
                locationLabel
              )}
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>Ваше местоположение:</span>{' '}
              {userLocationLoading ? 'Определяем…' : userLocationError ? (
                <span style={{ color: 'var(--danger)' }}>{userLocationError}</span>
              ) : (
                userLocationLabel
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchQuery(v);
                  setSearchDropdownVisible(v.trim().length >= 2);
                }}
                placeholder="Поиск населённого пункта…"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'var(--text)',
                  outline: 'none',
                  fontSize: 13,
                }}
              />
              {searchQuery.trim().length > 0 ? (
                <Button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchDropdownVisible(false);
                  }}
                  style={{ padding: '8px 10px' }}
                >
                  ×
                </Button>
              ) : null}
            </div>

            {searchError ? (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>{searchError}</div>
            ) : null}

            {searchDropdownVisible ? (
              <div
                style={{
                  marginTop: 8,
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.35)',
                  padding: 4,
                  // Make at most ~3 items visible, then allow scrolling for the rest.
                  maxHeight: searchResults.length > 3 ? 3 * 40 : undefined,
                  overflowY: searchResults.length > 3 ? 'auto' : 'visible',
                }}
              >
                {searchLoading && searchResults.length === 0 ? (
                  <div style={{ padding: 8, fontSize: 12, color: 'var(--muted)' }}>Загрузка…</div>
                ) : searchResults.length === 0 ? (
                  <div style={{ padding: 8, fontSize: 12, color: 'var(--muted)' }}>Ничего не найдено.</div>
                ) : (
                  searchResults.map((r, idx) => (
                    <button
                      key={`${r.lat}:${r.lon}:${idx}`}
                      type="button"
                      onClick={() => handleSelectSearchResult(r)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 8px',
                        borderRadius: 10,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      {r.display_name ?? `${r.lat}, ${r.lon}`}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {/* 8-direction navigation pad */}
          <div
            style={{
              position: 'absolute',
              right: 16,
              bottom: 80,
              zIndex: 12,
              pointerEvents: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 36px)',
              gridTemplateRows: 'repeat(3, 36px)',
              gap: 2,
            }}
          >
            {[
              { label: '\u2196', dx: -100, dy: -100 },
              { label: '\u2191', dx: 0, dy: -100 },
              { label: '\u2197', dx: 100, dy: -100 },
              { label: '\u2190', dx: -100, dy: 0 },
              { label: '', dx: 0, dy: 0 },
              { label: '\u2192', dx: 100, dy: 0 },
              { label: '\u2199', dx: -100, dy: 100 },
              { label: '\u2193', dx: 0, dy: 100 },
              { label: '\u2198', dx: 100, dy: 100 },
            ].map((dir, i) =>
              dir.label ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => leafletMapRef.current?.panBy([dir.dx, dir.dy])}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'rgba(0,0,0,0.45)',
                    color: 'var(--text)',
                    fontSize: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(6px)',
                  }}
                >
                  {dir.label}
                </button>
              ) : (
                <div key={i} />
              ),
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

export const EarthScene = memo(EarthSceneComponent);


