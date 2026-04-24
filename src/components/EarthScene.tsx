'use client';
// EarthScene — компонент интерфейса (React).


import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getEarthMaterialMode, getEarthMaxPixelRatio, getEarthSphereSegments } from '@/lib/earthQuality';
import { disposeEarthTextures, loadEarthTextures } from '@/lib/loadEarthTextures';
import {
  GLOBE_SCENE_BACKGROUND_HEX,
  GLOBE_DEFAULT_CENTER,
  applyLoadedEarthTextures,
  updateGlobeFrontLabelsVisibility,
} from '@/lib/three/globeAppearance';
import { TYPE_LABELS_RU } from '@/lib/three/factories';
import { colors } from '@/theme/colors';
import { normalizeLatLng } from '@/lib/geo/normalizeLatLng';
import {
  SATELLITE_MIN_VISIBLE_ZOOM,
  bboxFromGlobeView,
  expandBoundsForFetch,
  type BboxTuple,
} from '@/lib/geo/viewportBbox';
import { applyGlobeCenterToLeafletMap, getFrontGlobeCenterLatLng, syncGlobeToMapCenter } from '@/lib/three/globeMapSync';
import { latLngToVec3, makeTextMesh } from '@/lib/three/utils';
import { clearGlobeNetworkElements, syncGlobeNetworkElements } from '@/lib/three/syncGlobeNetworkElements';
import { WORLD_LABELS } from '@/lib/three/labels';
import { Panel } from './ui/Panel';
import { Button } from './ui/Button';
import { MapView } from './MapView';
import type { LatLng, NetworkResponseDTO, Scope } from '@/lib/types';
import {
  cableSourceLinks,
} from '@/lib/cableSourceLinks';
import type L from 'leaflet';

function isSatelliteElType(t: unknown): boolean {
  return t === 'SATELLITE' || t === 'SATELLITE_RASSVET';
}

type ViewMode = 'GLOBE_3D' | 'MAP_2D';

type EarthSceneProps = {
  satelliteNameQuery?: string | null;
};

type GlobeNetworkElementCard = {
  x: number;
  y: number;
  elName: string;
  elType: string;
  sourceUrl: string;
  providerId: string;
  providerName: string;
  metadata: Record<string, unknown> | null;
  scope: string;
};

function metadataRecord(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  return metadata && typeof metadata === 'object' ? metadata : null;
}

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const m = metadataRecord(metadata);
  const raw = m?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function metadataYearValue(metadata: Record<string, unknown> | null, key: string): number | null {
  const m = metadataRecord(metadata);
  const raw = m?.[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d{4}$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

function isOsmCableDataset(metadata: Record<string, unknown> | null): boolean {
  const dataset = metadataRecord(metadata)?.dataset;
  return dataset === 'openstreetmap' || dataset === 'osm_terrestrial_fibre';
}

function osmOperatorFromMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!isOsmCableDataset(metadata)) return null;
  const meta = metadataRecord(metadata);
  const osm = meta?.osm;
  if (!osm || typeof osm !== 'object' || Array.isArray(osm)) return null;
  const tags = (osm as Record<string, unknown>).tags;
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null;
  const raw = (tags as Record<string, unknown>).operator;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** Ранее использовался для авто-возврата в 3D; убран — ломал ручной режим «2D». */
const ZOOM_MIN = 1.2;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;
/** Порог смещения указателя (px), после которого жест считается вращением глобуса, а не кликом-«закреплением». */
const GLOBE_LMB_DRAG_THRESHOLD_PX = 7;

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

// WORLD_LABELS imported from '@/lib/three/labels'

function pointInDomRect(clientX: number, clientY: number, rect: DOMRectReadOnly): boolean {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

/** Расширенный rect — «мост» от тонкого кабеля до карточки hover. */
function padDomRect(rect: DOMRectReadOnly, pad: number): DOMRectReadOnly {
  return new DOMRect(rect.left - pad, rect.top - pad, rect.width + pad * 2, rect.height + pad * 2);
}

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

function sourceClassLabel(value: unknown): string | null {
  if (value === 'official') return 'Официальный';
  if (value === 'osm_verified') return 'OSM (проверенный)';
  if (value === 'synthetic') return 'Модельный';
  return null;
}

function GlobeLegendBody() {
  return (
    <>
      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12, color: '#eaf2ff' }}>Легенда</div>
      {[
        { color: '#3a7bd5', label: 'Подводный оптовол. кабель' },
        { color: '#d4a54a', label: 'Подводный медный кабель' },
        { color: '#00e676', label: 'Подземный оптовол. кабель', dashed: true },
        { color: '#ff7043', label: 'Подземный медный кабель', dashed: true },
      ].map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 18,
              height: 0,
              borderTop: `2px ${'dashed' in item && item.dashed ? 'dashed' : 'solid'} ${item.color}`,
              flexShrink: 0,
            }}
          />
          <span>{item.label}</span>
        </div>
      ))}
      <div style={{ marginTop: 4, borderTop: '1px solid rgba(120,160,255,0.12)', paddingTop: 4 }} />
      {[
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
      ].map((item) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: item.color, fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}>{item.shape}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </>
  );
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

function EarthSceneComponent({ satelliteNameQuery = null }: EarthSceneProps) {
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<NominatimSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDropdownVisible, setSearchDropdownVisible] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [targetCenter, setTargetCenter] = useState<LatLng | null>(null);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [hoveredElement, setHoveredElement] = useState<GlobeNetworkElementCard | null>(null);
  /** Закреплённая ЛКМ (короткий клик без перетаскивания) карточка элемента сети — удобно для ссылок. */
  const [pinnedElement, setPinnedElement] = useState<GlobeNetworkElementCard | null>(null);
  const pinnedElementRef = useRef<GlobeNetworkElementCard | null>(null);
  const globeHoverCardRef = useRef<HTMLDivElement | null>(null);
  /** Слушатель window pointermove (пока открыта карточка) делегирует в логику из эффекта Three.js. */
  const scheduleHoverFromPointerRef = useRef<(e: PointerEvent) => void>(() => {});
  /** Легенда открывается по клику и по умолчанию свёрнута. */
  const [viewportNarrow, setViewportNarrow] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  useLayoutEffect(() => {
    pinnedElementRef.current = pinnedElement;
  }, [pinnedElement]);

  const globeGroup = useMemo(() => new THREE.Group(), []);
  const networkGroup = useMemo(() => new THREE.Group(), []);
  /** Кабели/узлы из API — инкрементальный sync, без WORLD_LABELS. */
  const globeNetworkElementsGroup = useMemo(() => new THREE.Group(), []);
  /** Статические подписи WORLD_LABELS (не пересоздаются при каждом fetch сети). */
  const globeWorldLabelsGroup = useMemo(() => new THREE.Group(), []);
  const globeNetworkElementStateRef = useRef<
    Map<string, { root: THREE.Object3D; sig: string }>
  >(new Map());
  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of network?.providers ?? []) {
      map.set(p.id, p.name);
    }
    return map;
  }, [network?.providers]);
  const providerSourceUrlById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of network?.providers ?? []) {
      map.set(p.id, p.sourceUrl ?? '');
    }
    return map;
  }, [network?.providers]);

  const viewModeRef = useRef<ViewMode>(viewMode);
  const prevViewModeRef = useRef<ViewMode>(viewMode);
  const zoomRef = useRef<number>(zoom);
  const leafletMapRef = useRef<L.Map | null>(null);
  const savedCenterRef = useRef<{ lat: number; lng: number }>({
    ...normalizeLatLng(GLOBE_DEFAULT_CENTER.lat, GLOBE_DEFAULT_CENTER.lng),
  });
  /** Центр из кнопки «3D» до перехода — единственный явный источник для sync (порядок относительно onMapUnmount). */
  const pendingGlobeCenterRef = useRef<LatLng | null>(null);
  const networkAbortRef = useRef<AbortController | null>(null);
  const lastGlobeBboxKeyRef = useRef<string>('');
  /** Мышь/тач крутит глобус или pinch — не дергать bbox/fetch и не тяжело обновлять лейблы. */
  const globeInteractionBusyRef = useRef(false);
  /** Тело тика bbox из эффекта ниже — вызов после окончания drag для немедленного resync. */
  const runGlobeBboxTickRef = useRef<(() => void) | null>(null);
  /** После перехода GLOBE_3D → MAP_2D выставить Leaflet zoom 12 в onMapReady. */
  const applyMap2DZoom12Ref = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => setViewportNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const mapViewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodeLabelCandidatesRef = useRef<
    Array<{ sprite: THREE.Object3D; latRad: number; lngRad: number; sinLat: number; cosLat: number }>
  >([]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useLayoutEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;

    if (prev === 'MAP_2D' && viewMode === 'GLOBE_3D') {
      let c: LatLng;
      if (pendingGlobeCenterRef.current) {
        c = pendingGlobeCenterRef.current;
        pendingGlobeCenterRef.current = null;
      } else {
        c = normalizeLatLng(savedCenterRef.current.lat, savedCenterRef.current.lng);
      }
      savedCenterRef.current = c;
      setTargetCenter(c);
      syncGlobeToMapCenter(globeGroup, c.lat, c.lng);
    }
  }, [viewMode, globeGroup]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (viewMode !== 'GLOBE_3D') {
      for (const c of nodeLabelCandidatesRef.current) c.sprite.visible = false;
    }
  }, [viewMode]);

  const setMapCenterFromGlobe = useCallback(() => {
    const raw = getFrontGlobeCenterLatLng(globeGroup) ?? { lat: 0, lng: 0 };
    const center = normalizeLatLng(raw.lat, raw.lng);
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
    scene.background = new THREE.Color(GLOBE_SCENE_BACKGROUND_HEX);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    camera.position.set(0, 0, 3);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, getEarthMaxPixelRatio()));
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
    networkGroup.add(globeNetworkElementsGroup);
    networkGroup.add(globeWorldLabelsGroup);
    scene.add(globeGroup);

    syncGlobeToMapCenter(globeGroup, savedCenterRef.current.lat, savedCenterRef.current.lng);

    let cancelled = false;

    loadEarthTextures(renderer).then((set) => {
      if (!set) return;
      if (cancelled) {
        disposeEarthTextures(set);
        return;
      }
      applyLoadedEarthTextures(globe, clouds, set, materialMode);
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
    let touchDragging = false;
    let pinchActive = false;
    let globePointerDown = false;
    let globeDragCommitted = false;
    let globeDownX = 0;
    let globeDownY = 0;
    let pointerDownHitUserData: THREE.Object3D['userData'] | null = null;

    const syncGlobeInteractionBusyRef = () => {
      globeInteractionBusyRef.current = dragging || touchDragging || pinchActive;
    };

    const scheduleGlobeBboxResyncIfIdle = (busyBefore: boolean) => {
      syncGlobeInteractionBusyRef();
      if (busyBefore && !globeInteractionBusyRef.current) {
        lastGlobeBboxKeyRef.current = '';
        requestAnimationFrame(() => {
          runGlobeBboxTickRef.current?.();
        });
      }
    };
    let lastPinchDist = 0;
    /** Есть опорный unit-вектор на сфере для инкрементального trackball. */
    let globeDragHasAnchor = false;
    const lastGlobeDir = new THREE.Vector3();
    const currGlobeDir = new THREE.Vector3();
    const rotAxis = new THREE.Vector3();
    const sphereCenter = new THREE.Vector3();
    const sphereScale = new THREE.Vector3();
    const ocRay = new THREE.Vector3();
    const TRACKBALL_MAX_RAD_PER_EVENT = 0.55;

    const pointerForHover = { x: 0, y: 0 };
    let hoverRafId = 0;
    let hoverScheduled = false;
    let lastHoverKey: string | null = null;

    const saveGlobeFrontCenterToSavedRef = () => {
      const raw = getFrontGlobeCenterLatLng(globeGroup) ?? { lat: 0, lng: 0 };
      savedCenterRef.current = normalizeLatLng(raw.lat, raw.lng);
    };

    const touchDistance = (touches: TouchList) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const cancelPendingHoverRaycast = () => {
      if (hoverRafId) {
        cancelAnimationFrame(hoverRafId);
        hoverRafId = 0;
      }
      hoverScheduled = false;
    };

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.01 };
    const mouseNDC = new THREE.Vector2();
    const MAX_HIT_DISTANCE_BEHIND_GLOBE = 0.028;

    /** Меньше — выше приоритет при сортировке кандидатов (см. pickNetworkElementObjectAt). */
    const getNetworkElTypePriority = (elType: unknown): number => {
      if (typeof elType !== 'string') return 99;
      if (isSatelliteElType(elType)) return 1;
      if (elType.startsWith('CABLE_')) return 3;
      return 2;
    };

    const pickNetworkElementObjectAt = (clientX: number, clientY: number): THREE.Object3D | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      const cam = cameraRef.current;
      if (!cam) return null;
      raycaster.setFromCamera(mouseNDC, cam);

      const globeHit = raycaster.intersectObject(globe, false)[0];
      const globeDistance = globeHit?.distance;
      const hideSatellites = zoomRef.current < SATELLITE_MIN_VISIBLE_ZOOM;
      const hits = raycaster.intersectObjects([globeNetworkElementsGroup], true);
      const candidates: Array<{ obj: THREE.Object3D; distance: number; priority: number }> = [];
      const seenKeys = new Set<string>();

      for (const h of hits) {
        if (
          typeof globeDistance === 'number' &&
          h.distance > globeDistance + MAX_HIT_DISTANCE_BEHIND_GLOBE
        ) {
          continue;
        }
        let obj: THREE.Object3D | null = h.object;
        while (obj && !obj.userData?.elType) obj = obj.parent;
        if (!obj?.userData?.elType) continue;
        if (hideSatellites && isSatelliteElType(obj.userData.elType)) continue;
        const dedupeKey =
          (typeof obj.userData.hoverKey === 'string' && obj.userData.hoverKey) || obj.uuid;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        candidates.push({
          obj,
          distance: h.distance,
          priority: getNetworkElTypePriority(obj.userData.elType),
        });
      }

      if (candidates.length === 0) return null;
      candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.distance - b.distance;
      });
      return candidates[0]?.obj ?? null;
    };

    /** Луч из экранных координат → единичный вектор от центра глобуса к точке на сфере (world). */
    const setCurrGlobeDirFromClient = (clientX: number, clientY: number): boolean => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      const cam = cameraRef.current;
      if (!cam) return false;
      raycaster.setFromCamera(mouseNDC, cam);
      globe.getWorldPosition(sphereCenter);
      globe.getWorldScale(sphereScale);
      const radius = Math.max(sphereScale.x, sphereScale.y, sphereScale.z);
      // Аналитическое пересечение луча со сферой — без BVH/raycast по высокополигональному mesh (дешево на каждом pointermove).
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

    const pickNetworkElementUserDataAt = (
      clientX: number,
      clientY: number,
    ): THREE.Object3D['userData'] | null => {
      return pickNetworkElementObjectAt(clientX, clientY)?.userData ?? null;
    };

    const clearHoverCard = () => {
      lastHoverKey = null;
      setHoveredElement(null);
    };

    const pinCardFromUserData = (ud: THREE.Object3D['userData'], clientX: number, clientY: number) => {
      setPinnedElement({
        x: clientX,
        y: clientY,
        elName: ud.elName ?? '',
        elType: ud.elType ?? '',
        sourceUrl: ud.sourceUrl ?? '',
        providerId: ud.providerId ?? '',
        providerName: ud.providerName ?? '',
        metadata: (ud.metadata as Record<string, unknown> | null) ?? null,
        scope: String(ud.scope ?? ''),
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0) return;
      if (viewModeRef.current !== 'GLOBE_3D') return;
      cancelPendingHoverRaycast();
      clearHoverCard();
      pointerDownHitUserData = pickNetworkElementUserDataAt(e.clientX, e.clientY);
      globePointerDown = true;
      globeDragCommitted = false;
      globeDownX = e.clientX;
      globeDownY = e.clientY;
      dragging = false;
      syncGlobeInteractionBusyRef();
      globeDragHasAnchor = false;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const hadShortGlobeClick =
        globePointerDown && !globeDragCommitted && viewModeRef.current === 'GLOBE_3D';
      globePointerDown = false;
      globeDragCommitted = false;

      if (hadShortGlobeClick) {
        const ud = pickNetworkElementUserDataAt(e.clientX, e.clientY) ?? pointerDownHitUserData;
        if (ud?.elType) {
          pinCardFromUserData(ud, e.clientX, e.clientY);
          clearHoverCard();
        } else {
          setPinnedElement(null);
        }
      }
      pointerDownHitUserData = null;

      const busyBefore = dragging || touchDragging || pinchActive;
      if (dragging) saveGlobeFrontCenterToSavedRef();
      dragging = false;
      globeDragHasAnchor = false;
      scheduleGlobeBboxResyncIfIdle(busyBefore);
      try {
        if (renderer.domElement.hasPointerCapture(e.pointerId)) {
          renderer.domElement.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
    };
    const onLostPointerCapture = () => {
      globePointerDown = false;
      globeDragCommitted = false;
      pointerDownHitUserData = null;
      const busyBefore = dragging || touchDragging || pinchActive;
      if (dragging) saveGlobeFrontCenterToSavedRef();
      dragging = false;
      globeDragHasAnchor = false;
      scheduleGlobeBboxResyncIfIdle(busyBefore);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      globePointerDown = false;
      globeDragCommitted = false;
      pointerDownHitUserData = null;
      const busyBefore = dragging || touchDragging || pinchActive;
      if (dragging) saveGlobeFrontCenterToSavedRef();
      dragging = false;
      globeDragHasAnchor = false;
      scheduleGlobeBboxResyncIfIdle(busyBefore);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (viewModeRef.current !== 'GLOBE_3D') return;
      if (!globePointerDown) return;
      if (!globeDragCommitted) {
        const dx = e.clientX - globeDownX;
        const dy = e.clientY - globeDownY;
        if (dx * dx + dy * dy < GLOBE_LMB_DRAG_THRESHOLD_PX * GLOBE_LMB_DRAG_THRESHOLD_PX) return;
        globeDragCommitted = true;
        pointerDownHitUserData = null;
        dragging = true;
        syncGlobeInteractionBusyRef();
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
      if (viewModeRef.current !== 'GLOBE_3D') return;
      e.preventDefault();
      const c = cameraRef.current;
      if (!c) return;
      const factor = e.ctrlKey ? 0.004 : 0.0015;
      const next = THREE.MathUtils.clamp(c.position.z + e.deltaY * factor, ZOOM_MIN, ZOOM_MAX);
      c.position.z = next;
      setZoom(next);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (viewModeRef.current !== 'GLOBE_3D') return;
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
      syncGlobeInteractionBusyRef();
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
        applyTrackballAt(t.clientX, t.clientY);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (viewModeRef.current !== 'GLOBE_3D') return;
      const busyBefore = dragging || touchDragging || pinchActive;
      if (e.touches.length === 0) {
        if (touchDragging && !pinchActive) saveGlobeFrontCenterToSavedRef();
        touchDragging = false;
        pinchActive = false;
        lastPinchDist = 0;
        globeDragHasAnchor = false;
        scheduleGlobeBboxResyncIfIdle(busyBefore);
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
        syncGlobeInteractionBusyRef();
      } else if (e.touches.length === 2) {
        lastPinchDist = touchDistance(e.touches);
        syncGlobeInteractionBusyRef();
      }
    };

    const flushHoverRaycast = () => {
      hoverScheduled = false;
      if (viewModeRef.current !== 'GLOBE_3D') {
        clearHoverCard();
        return;
      }
      if (globeInteractionBusyRef.current) {
        clearHoverCard();
        return;
      }
      if (pinnedElementRef.current) {
        return;
      }
      const px = pointerForHover.x;
      const py = pointerForHover.y;
      const strictRect = globeHoverCardRef.current?.getBoundingClientRect();
      const hasCardDom =
        !!strictRect && strictRect.width > 0 && strictRect.height > 0;
      if (hasCardDom && lastHoverKey !== null && pointInDomRect(px, py, strictRect)) {
        // Не сдвигаем hover-карточку вместе с курсором поверх самой карточки:
        // иначе карточка "едет" за мышью и может залипать без реального hover по объекту.
        setHoveredElement((prev) => prev);
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const pointerInsideCanvas = pointInDomRect(px, py, rect);
      if (!pointerInsideCanvas) {
        const bridgeRect = hasCardDom && strictRect ? padDomRect(strictRect, 28) : null;
        if (bridgeRect && pointInDomRect(px, py, bridgeRect)) {
          // Bridge разрешает короткий переход с тонкого объекта на карточку,
          // но не должен перемещать карточку за пределы фактического объекта.
          setHoveredElement((prev) => prev);
          return;
        }
        clearHoverCard();
        return;
      }
      const found = pickNetworkElementObjectAt(px, py);
      if (found) {
        const ud = found.userData;
        const key = `${ud.elType}|${String(ud.elName ?? '')}|${String(ud.providerId ?? '')}|${String(ud.hoverKey ?? '')}`;
        if (key === lastHoverKey) {
          setHoveredElement((prev) =>
            prev
              ? { ...prev, x: px, y: py }
              : {
                  x: px,
                  y: py,
                  elName: ud.elName ?? '',
                  elType: ud.elType ?? '',
                  sourceUrl: ud.sourceUrl ?? '',
                  providerId: ud.providerId ?? '',
                  providerName: ud.providerName ?? '',
                  metadata: ud.metadata ?? null,
                  scope: ud.scope ?? '',
                },
          );
        } else {
          lastHoverKey = key;
          setHoveredElement({
            x: px,
            y: py,
            elName: ud.elName ?? '',
            elType: ud.elType ?? '',
            sourceUrl: ud.sourceUrl ?? '',
            providerId: ud.providerId ?? '',
            providerName: ud.providerName ?? '',
            metadata: ud.metadata ?? null,
            scope: ud.scope ?? '',
          });
        }
      } else if (lastHoverKey !== null) {
        const bridgeRect = hasCardDom && strictRect ? padDomRect(strictRect, 28) : null;
        if (bridgeRect && pointInDomRect(px, py, bridgeRect)) {
          setHoveredElement((prev) => prev);
          return;
        }
        clearHoverCard();
      }
    };

    const onHoverMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (viewModeRef.current !== 'GLOBE_3D') {
        clearHoverCard();
        return;
      }
      if (globeInteractionBusyRef.current) {
        clearHoverCard();
        return;
      }
      if (pinnedElementRef.current) return;
      pointerForHover.x = e.clientX;
      pointerForHover.y = e.clientY;
      if (hoverScheduled) return;
      hoverScheduled = true;
      hoverRafId = requestAnimationFrame(() => {
        hoverRafId = 0;
        flushHoverRaycast();
      });
    };

    scheduleHoverFromPointerRef.current = onHoverMove;

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointermove', onHoverMove);
    renderer.domElement.addEventListener('lostpointercapture', onLostPointerCapture);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: true });
    renderer.domElement.addEventListener('touchcancel', onTouchEnd, { passive: true });

    let lastShowSatellites: boolean | null = null;
    let lastNetworkGroupLenForSat = -1;
    const animate = () => {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      if (!r || !s || !c) return;
      frameRef.current = requestAnimationFrame(animate);

      // Local 3D labels: показываем только объекты рядом с текущим "центром" глобуса (front-face only).
      if (
        viewModeRef.current === 'GLOBE_3D' &&
        !globeInteractionBusyRef.current &&
        nodeLabelCandidatesRef.current.length > 0
      ) {
        const z = zoomRef.current;
        updateGlobeFrontLabelsVisibility(nodeLabelCandidatesRef.current, globeGroup, z, 56);
      }
      if (viewModeRef.current === 'GLOBE_3D' && globeNetworkElementsGroup.children.length > 0) {
        const showSatellites = zoomRef.current >= SATELLITE_MIN_VISIBLE_ZOOM;
        const satLen = globeNetworkElementsGroup.children.length;
        if (lastNetworkGroupLenForSat !== satLen) {
          lastNetworkGroupLenForSat = satLen;
          lastShowSatellites = null;
        }
        if (lastShowSatellites !== showSatellites) {
          lastShowSatellites = showSatellites;
          for (const ch of globeNetworkElementsGroup.children) {
            // Только корневой Group.visible=false не отключает raycast у дочерних Mesh (Three.js).
            if (isSatelliteElType(ch.userData?.elType)) {
              ch.traverse((obj) => {
                obj.visible = showSatellites;
              });
            }
          }
        }
      }
      r.render(s, c);
    };
    animate();

    return () => {
      cancelled = true;

      window.removeEventListener('resize', onResize);
      cancelPendingHoverRaycast();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('pointermove', onHoverMove);
      renderer.domElement.removeEventListener('lostpointercapture', onLostPointerCapture);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
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
      scheduleHoverFromPointerRef.current = () => {};
    };
  }, [globeGroup, networkGroup, globeNetworkElementsGroup, globeWorldLabelsGroup]);

  /** Пока открыта карточка (hover или закреп), движение над ней не доходит до canvas — слушаем window. */
  useEffect(() => {
    if (viewMode !== 'GLOBE_3D' || (!hoveredElement && !pinnedElement)) return;
    const onWinPointerMove = (e: PointerEvent) => {
      scheduleHoverFromPointerRef.current(e);
    };
    window.addEventListener('pointermove', onWinPointerMove);
    return () => window.removeEventListener('pointermove', onWinPointerMove);
  }, [hoveredElement, pinnedElement, viewMode]);

  useEffect(() => {
    if (viewMode !== 'GLOBE_3D') setPinnedElement(null);
  }, [viewMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinnedElement(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (viewMode !== 'MAP_2D') {
      setReverseCenter(null);
      setLocationLabel('—');
      setLocationError(null);
      setLocationLoading(false);
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
    if (viewMode !== 'MAP_2D' && viewMode !== 'GLOBE_3D') return;
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
    const n = normalizeLatLng(c.lat, c.lng);
    savedCenterRef.current = { lat: n.lat, lng: n.lng };
    setTargetCenter(n);
    setReverseCenter((prev) => {
      if (
        prev &&
        Math.abs(prev.lat - n.lat) < 1e-6 &&
        Math.abs(prev.lng - n.lng) < 1e-6
      ) {
        return prev;
      }
      return n;
    });
  }, []);

  const handleSelectSearchResult = useCallback((r: NominatimSearchResult) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const n = normalizeLatLng(lat, lng);
    setTargetCenter(n);
    setReverseCenter((prev) => {
      if (prev && Math.abs(prev.lat - n.lat) < 1e-6 && Math.abs(prev.lng - n.lng) < 1e-6) return prev;
      return n;
    });
    setSearchResults([]);
    setSearchError(null);
    setSearchLoading(false);
    setSearchDropdownVisible(false);
    setSearchQuery(r.display_name ?? '');

    if (viewMode === 'MAP_2D') {
      setMapZoom(12);
      const m = leafletMapRef.current;
      if (m) applyGlobeCenterToLeafletMap(m, n, 12);
    } else if (viewMode === 'GLOBE_3D') {
      syncGlobeToMapCenter(globeGroup, n.lat, n.lng);
      savedCenterRef.current = { lat: n.lat, lng: n.lng };
      pendingGlobeCenterRef.current = n;
    }
  }, [viewMode, globeGroup]);

  const runNetworkFetch = useCallback(
    async (bbox: BboxTuple, z: number) => {
      setNetworkError(null);
      networkAbortRef.current?.abort();
      const ac = new AbortController();
      networkAbortRef.current = ac;
      const expanded = expandBoundsForFetch(bbox);
      try {
        const url = new URL('/api/network', window.location.origin);
        url.searchParams.set('scope', scope);
        url.searchParams.set('bbox', expanded.join(','));
        url.searchParams.set('z', String(z));
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as NetworkResponseDTO;
        setNetwork(data);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setNetworkError(e instanceof Error ? e.message : 'Unknown error');
      }
    },
    [scope],
  );

  useEffect(() => {
    return () => {
      networkAbortRef.current?.abort();
      if (mapViewportDebounceRef.current) clearTimeout(mapViewportDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    lastGlobeBboxKeyRef.current = '';
  }, [scope]);

  useEffect(() => {
    if (viewMode !== 'GLOBE_3D') return;
    lastGlobeBboxKeyRef.current = '';
    const tick = () => {
      if (globeInteractionBusyRef.current) return;
      const raw = getFrontGlobeCenterLatLng(globeGroup);
      const c = raw
        ? normalizeLatLng(raw.lat, raw.lng)
        : normalizeLatLng(GLOBE_DEFAULT_CENTER.lat, GLOBE_DEFAULT_CENTER.lng);
      const bbox = bboxFromGlobeView(c, zoomRef.current);
      const key = `${bbox.map((x) => x.toFixed(4)).join(',')}|${zoomRef.current.toFixed(2)}`;
      if (key === lastGlobeBboxKeyRef.current) return;
      lastGlobeBboxKeyRef.current = key;
      void runNetworkFetch(bbox, zoomRef.current);
    };
    runGlobeBboxTickRef.current = tick;
    tick();
    const id = window.setInterval(tick, 1500);
    return () => {
      clearInterval(id);
      runGlobeBboxTickRef.current = null;
    };
  }, [viewMode, globeGroup, runNetworkFetch]);

  const handleMapViewportChange = useCallback(
    (payload: { bbox: BboxTuple; zoom: number }) => {
      if (viewModeRef.current !== 'MAP_2D') return;
      if (mapViewportDebounceRef.current) clearTimeout(mapViewportDebounceRef.current);
      mapViewportDebounceRef.current = setTimeout(() => {
        mapViewportDebounceRef.current = null;
        void runNetworkFetch(payload.bbox, payload.zoom);
      }, 300);
    },
    [runNetworkFetch],
  );

  useEffect(() => {
    if (viewMode !== 'MAP_2D') return;
    const map = leafletMapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const bbox: BboxTuple = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
    void runNetworkFetch(bbox, map.getZoom());
  }, [scope, viewMode, runNetworkFetch]);

  /** WORLD_LABELS один раз при первом 3D; не зависит от fetch сети. */
  useEffect(() => {
    if (viewMode !== 'GLOBE_3D') return;
    if (globeWorldLabelsGroup.children.length > 0) return;

    const DEG2RAD = Math.PI / 180;
    nodeLabelCandidatesRef.current = [];
    for (const wl of WORLD_LABELS) {
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
      globeWorldLabelsGroup.add(mesh);

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
  }, [viewMode, globeWorldLabelsGroup]);

  /** Инкрементальное обновление кабелей/узлов в globeNetworkElementsGroup. */
  useEffect(() => {
    const disposedTextures = new WeakSet<THREE.Texture>();

    if (viewMode !== 'GLOBE_3D') {
      clearGlobeNetworkElements(
        globeNetworkElementsGroup,
        globeNetworkElementStateRef.current,
        disposedTextures,
      );
      return;
    }

    if (!network) {
      clearGlobeNetworkElements(
        globeNetworkElementsGroup,
        globeNetworkElementStateRef.current,
        disposedTextures,
      );
      return;
    }

    syncGlobeNetworkElements({
      elements: network.elements,
      elementsGroup: globeNetworkElementsGroup,
      providerNameById,
      stateById: globeNetworkElementStateRef.current,
      disposedTextures,
    });
  }, [viewMode, network, providerNameById, globeNetworkElementsGroup]);

  // Единый источник отображения:
  // 1) pinnedElement (явное закрепление ЛКМ), иначе 2) hoveredElement (временный hover).
  const globeInfoCard = pinnedElement ?? hoveredElement;
  const cardOwner =
    metadataString(globeInfoCard?.metadata ?? null, 'owner');
  const cardLaunchDate =
    metadataString(globeInfoCard?.metadata ?? null, 'launchDate') ??
    metadataString(globeInfoCard?.metadata ?? null, 'launch_date');
  const cardLaunchYear =
    metadataYearValue(globeInfoCard?.metadata ?? null, 'launchYear') ??
    metadataYearValue(globeInfoCard?.metadata ?? null, 'launch_year');
  const cardOsmOperator = osmOperatorFromMetadata(globeInfoCard?.metadata ?? null);
  const providerLabel = isOsmCableDataset(globeInfoCard?.metadata ?? null) ? 'Источник данных' : 'Провайдер';

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
                const raw = map
                  ? { lat: map.getCenter().lat, lng: map.getCenter().lng }
                  : savedCenterRef.current;
                const center = normalizeLatLng(raw.lat, raw.lng);
                savedCenterRef.current = center;
                setTargetCenter(center);
                syncGlobeToMapCenter(globeGroup, center.lat, center.lng);
                pendingGlobeCenterRef.current = center;
                setViewMode('GLOBE_3D');
              }}
            >
              3D
            </Button>
            <Button
              onClick={() => {
                setMapCenterFromGlobe();
                applyMap2DZoom12Ref.current = true;
                setMapZoom(12);
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
                elements: {network.elements.length}
              </span>
            ) : (
              <span>loading…</span>
            )}
          </div>
        </Panel>
      </div>

      {/* Карточка элемента сети: hover или закрепление ЛКМ (короткий клик) */}
      {globeInfoCard && viewMode === 'GLOBE_3D' && (
        <div
          ref={globeHoverCardRef}
          style={{
            position: 'fixed',
            left: globeInfoCard.x + 14,
            top: globeInfoCard.y + 14,
            zIndex: 120,
            pointerEvents: 'auto',
            background: colors.bg.card,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            padding: pinnedElement ? '10px 32px 10px 14px' : '10px 14px',
            maxWidth: 340,
            fontSize: 13,
            color: colors.text.primary,
            lineHeight: 1.5,
          }}
        >
          {pinnedElement ? (
            <button
              type="button"
              aria-label="Снять закрепление"
              onClick={() => setPinnedElement(null)}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 26,
                height: 26,
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                color: colors.text.primary,
                background: colors.bg.primary,
                border: `1px solid ${colors.border}`,
              }}
            >
              ×
            </button>
          ) : null}
          {globeInfoCard.elName && (
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>{globeInfoCard.elName}</div>
          )}
          <div style={{ color: colors.text.secondary, marginBottom: 2 }}>
            {TYPE_LABELS_RU[globeInfoCard.elType] ?? globeInfoCard.elType}
          </div>
          {globeInfoCard.providerName && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>{providerLabel}:</span> {globeInfoCard.providerName}
            </div>
          )}
          {cardOsmOperator ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Оператор:</span> {cardOsmOperator}
            </div>
          ) : null}
          {globeInfoCard.metadata?.sourceClass ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Класс источника:</span>{' '}
              {sourceClassLabel(globeInfoCard.metadata.sourceClass) ?? String(globeInfoCard.metadata.sourceClass)}
            </div>
          ) : null}
          {globeInfoCard.metadata?.sourceClass === 'synthetic' ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Статус:</span> Модельная трасса (справочная)
            </div>
          ) : null}
          {isSatelliteElType(globeInfoCard.elType) && cardOwner ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Owner:</span> {cardOwner}
            </div>
          ) : null}
          {isSatelliteElType(globeInfoCard.elType) && (cardLaunchDate || cardLaunchYear !== null) ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Запуск:</span>{' '}
              {cardLaunchDate ?? (cardLaunchYear !== null ? String(cardLaunchYear) : '—')}
            </div>
          ) : null}
          {globeInfoCard.metadata?.countries ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Страны:</span>{' '}
              {Array.isArray(globeInfoCard.metadata.countries)
                ? (globeInfoCard.metadata.countries as string[]).join(', ')
                : String(globeInfoCard.metadata.countries)}
            </div>
          ) : null}
          {globeInfoCard.metadata?.year ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Год:</span> {String(globeInfoCard.metadata.year)}
            </div>
          ) : null}
          {(() => {
            const providerSourceUrl = globeInfoCard.providerId
              ? (providerSourceUrlById.get(globeInfoCard.providerId) ?? '')
              : '';
            const links = cableSourceLinks({
              elType: globeInfoCard.elType,
              cableName: globeInfoCard.elName,
              metadata: globeInfoCard.metadata,
              elementSourceUrl: globeInfoCard.sourceUrl,
              providerSourceUrl,
              satelliteNameQuery,
            });
            if (links.length === 0) return null;
            return (
              <div style={{ marginTop: 6, marginBottom: 2, fontSize: 12 }}>
                <div style={{ color: colors.text.secondary, marginBottom: 4 }}>Источники</div>
                {links.map((link) => (
                  <div key={`${link.label}:${link.href}`} style={{ marginBottom: 4 }}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer" style={{ color: colors.accent }}>
                      {link.label}
                    </a>
                    {link.domain ? (
                      <span style={{ marginLeft: 6, color: colors.text.secondary, fontSize: 11 }}>
                        ({link.domain})
                      </span>
                    ) : null}
                    {link.note ? (
                      <div style={{ marginTop: 1, color: colors.text.secondary, fontSize: 11 }}>{link.note}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })()}
          {(() => {
            const wfs =
              globeInfoCard.metadata?.wfs && typeof globeInfoCard.metadata.wfs === 'object'
                ? (globeInfoCard.metadata.wfs as Record<string, unknown>)
                : null;
            const desc =
              (typeof globeInfoCard.metadata?.description === 'string' && globeInfoCard.metadata.description.trim()
                ? globeInfoCard.metadata.description
                : null) ??
              (typeof wfs?.description === 'string' ? wfs.description : null);
            if (!desc || !String(desc).trim()) return null;
            return (
              <div style={{ marginBottom: 2, fontStyle: 'italic', color: colors.text.secondary }}>
                {String(desc)}
              </div>
            );
          })()}
          {(() => {
            const wfs =
              globeInfoCard.metadata?.wfs && typeof globeInfoCard.metadata.wfs === 'object'
                ? (globeInfoCard.metadata.wfs as Record<string, unknown>)
                : null;
            if (!wfs) return null;
            const folder = wfs.Folder;
            const phone = wfs.phoneNumber;
            return (
              <>
                {typeof folder === 'string' && folder.trim() ? (
                  <div style={{ marginBottom: 2, fontSize: 12 }}>
                    <span style={{ color: colors.text.secondary }}>Папка (WFS):</span> {folder}
                  </div>
                ) : null}
                {typeof phone === 'string' && phone.trim() ? (
                  <div style={{ marginBottom: 2, fontSize: 12 }}>
                    <span style={{ color: colors.text.secondary }}>Телефон:</span> {phone}
                  </div>
                ) : null}
              </>
            );
          })()}
          {globeInfoCard.metadata?.operator ? (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: colors.text.secondary }}>Оператор:</span> {String(globeInfoCard.metadata.operator)}
            </div>
          ) : null}
          <div style={{ marginTop: 4, fontSize: 11, color: colors.text.secondary }}>
            {pinnedElement ? 'Закреплено — ×, Esc или ЛКМ по фону глобуса. ' : null}
            {globeInfoCard.scope === 'GLOBAL' ? 'Глобальный' : globeInfoCard.scope === 'LOCAL' ? 'Локальный' : ''}
          </div>
        </div>
      )}

      {/* Поиск населённого пункта поверх 3D (как на странице предложения) */}
      {viewMode === 'GLOBE_3D' && (
        <div
          className="earth-globe-search-overlay"
          style={{
            position: 'absolute',
            top: 62,
            right: 12,
            zIndex: 12,
            width: 260,
            maxWidth: 'calc(100vw - 24px)',
            pointerEvents: 'auto',
          }}
        >
          <input
            value={searchQuery}
            onChange={(e) => {
              const v = e.target.value;
              setSearchQuery(v);
              setSearchDropdownVisible(v.trim().length >= 2);
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Поиск поселения…"
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 4,
              border: `1px solid ${searchFocused ? colors.accent : colors.border}`,
              background: colors.bg.card,
              color: colors.text.primary,
              fontSize: 12,
              outline: 'none',
            }}
          />
          {searchDropdownVisible && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 4,
                background: colors.bg.card,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                maxHeight: 180,
                overflowY: 'auto',
                zIndex: 20,
              }}
            >
              {searchLoading && searchResults.length === 0 ? (
                <div style={{ padding: 8, fontSize: 11, color: 'var(--muted)' }}>Загрузка…</div>
              ) : searchError ? (
                <div style={{ padding: 8, fontSize: 11, color: 'var(--danger)' }}>{searchError}</div>
              ) : searchResults.length === 0 ? (
                <div style={{ padding: 8, fontSize: 11, color: 'var(--muted)' }}>Ничего не найдено</div>
              ) : (
                searchResults.map((r, idx) => (
                  <button
                    key={`${r.lat}:${r.lon}:${idx}`}
                    type="button"
                    onClick={() => handleSelectSearchResult(r)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 10px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {(r.display_name ?? `${r.lat}, ${r.lon}`).slice(0, 80)}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend overlay (3D mode only): сворачиваемая панель со скроллом */}
      {viewMode === 'GLOBE_3D' && (
        <>
          {legendOpen && viewportNarrow ? (
            <div
              role="presentation"
              onClick={() => setLegendOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9,
                background: 'rgba(0,0,0,0.22)',
              }}
            />
          ) : null}
          <div
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              zIndex: 10,
              maxWidth: 'min(210px, calc(100vw - 24px))',
              pointerEvents: 'auto',
            }}
          >
            {legendOpen ? (
              <div
                id="globe-legend-panel"
                role="dialog"
                aria-modal={viewportNarrow ? 'true' : undefined}
                aria-label="Легенда типов сети"
                onClick={(e) => e.stopPropagation()}
                style={{
                  marginBottom: 8,
                  background: colors.bg.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  padding: '10px 14px',
                  fontSize: 11,
                  color: colors.text.primary,
                  lineHeight: 1.7,
                  maxHeight: 'min(22vh, 170px)',
                  overflowY: 'auto',
                }}
              >
                <GlobeLegendBody />
              </div>
            ) : null}
            <Button
              type="button"
              onClick={() => setLegendOpen((prev) => !prev)}
              aria-expanded={legendOpen}
              aria-controls="globe-legend-panel"
              style={{ padding: '10px 14px' }}
            >
              {legendOpen ? 'Легенда ▲' : 'Легенда ▼'}
            </Button>
          </div>
        </>
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
              mapZoom={mapZoom}
              center={targetCenter}
              initialCenter={targetCenter}
              onCenterChanged={handleCenterChanged}
              onMapReady={(m) => {
                leafletMapRef.current = m;
                setMapLoadError(null);
                if (applyMap2DZoom12Ref.current) {
                  const c = savedCenterRef.current;
                  applyGlobeCenterToLeafletMap(m, { lat: c.lat, lng: c.lng }, 12);
                  setMapZoom(12);
                  applyMap2DZoom12Ref.current = false;
                }
              }}
              onMapUnmount={(center) => {
                leafletMapRef.current = null;
                const n = normalizeLatLng(center.lat, center.lng);
                savedCenterRef.current = n;
                setTargetCenter(n);
              }}
              onZoomChanged={(z) => setMapZoom(z)}
              onViewportChange={handleMapViewportChange}
              onError={(msg) => setMapLoadError(msg)}
            />
            {mapLoadError && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.6)', zIndex: 2,
              }}>
                <div style={{
                  background: colors.bg.card, padding: 24, borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  maxWidth: 400, textAlign: 'center',
                }}>
                  <p style={{ color: 'var(--danger)', marginBottom: 8 }}>Не удалось загрузить карту</p>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{mapLoadError}</p>
                  <button
                    type="button"
                    onClick={() => { setMapLoadError(null); setViewMode('MAP_2D'); }}
                    style={{
                      marginTop: 12, padding: '6px 16px', borderRadius: 4,
                      border: `1px solid ${colors.accent}`, background: 'transparent',
                      color: colors.text.primary, cursor: 'pointer',
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

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchQuery(v);
                  setSearchDropdownVisible(v.trim().length >= 2);
                }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Поиск населённого пункта…"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 4,
                  border: `1px solid ${searchFocused ? colors.accent : colors.border}`,
                  background: colors.bg.primary,
                  color: colors.text.primary,
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
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  background: colors.bg.card,
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
                        borderRadius: 4,
                        border: 'none',
                        background: 'transparent',
                        color: colors.text.primary,
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
              right: 12,
              bottom: 12,
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
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                    background: colors.bg.card,
                    color: colors.text.primary,
                    fontSize: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
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


