'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';
import { EQUIPMENT_FACTORIES, NODE_VISUALS, CABLE_COLORS, createSatelliteObject } from '@/lib/three/factories';
import { getFrontGlobeCenterLatLng, syncGlobeToMapCenter } from '@/lib/three/globeMapSync';
import { latLngToVec3, makeTextMesh, disposeThreeObject } from '@/lib/three/utils';
import { WORLD_LABELS } from '@/lib/three/labels';
import { getEarthMaterialMode, getEarthSphereSegments } from '@/lib/earthQuality';
import { disposeEarthTextures, loadEarthTextures } from '@/lib/loadEarthTextures';
import {
  GLOBE_SCENE_BACKGROUND_HEX,
  GLOBE_DEFAULT_CENTER,
  applyLoadedEarthTextures,
  updateGlobeFrontLabelsVisibility,
  type GlobeLabelCandidate,
} from '@/lib/three/globeAppearance';
import { Button } from '@/components/ui/Button';

import type { NetworkResponseDTO } from '@/lib/types';
import type L from 'leaflet';

type ElementType =
  | 'SERVER' | 'SWITCH' | 'MULTIPLEXER' | 'DEMULTIPLEXER' | 'BASE_STATION'
  | 'REGENERATOR' | 'PROVIDER' | 'SATELLITE' | 'MESH_RELAY' | 'SMS_GATEWAY'
  | 'VSAT_TERMINAL' | 'OFFLINE_QUEUE'
  | 'CABLE_UNDERGROUND_FIBER' | 'CABLE_UNDERGROUND_COPPER' | 'CABLE_FIBER' | 'CABLE_COPPER';

type SandboxElement = {
  tempId: string;
  type: ElementType;
  name: string;
  lat: number;
  lng: number;
  fromId?: string;
  toId?: string;
};

type ViewMode = 'MAP_2D' | 'GLOBE_3D';

type SearchResult = { lat: string; lon: string; display_name?: string };

const DEG2RAD = Math.PI / 180;

const ELEMENT_TYPES: { category: string; types: { type: ElementType; label: string; color?: string }[] }[] = [
  {
    category: 'Оборудование',
    types: [
      { type: 'SERVER', label: 'Сервер', color: '#3ddc97' },
      { type: 'SWITCH', label: 'Коммутатор', color: '#f6c177' },
      { type: 'MULTIPLEXER', label: 'Мультиплексор', color: '#e6a7ff' },
      { type: 'DEMULTIPLEXER', label: 'Демультиплексор', color: '#b36cff' },
      { type: 'BASE_STATION', label: 'Базовая станция', color: '#ffc3a0' },
      { type: 'REGENERATOR', label: 'Регенератор', color: '#7df1ff' },
      { type: 'PROVIDER', label: 'Провайдер', color: '#7aa2ff' },
    ],
  },
  {
    category: 'Офлайн-инфраструктура',
    types: [
      { type: 'MESH_RELAY', label: 'Mesh-ретранслятор', color: '#00e5ff' },
      { type: 'SMS_GATEWAY', label: 'SMS-шлюз (2G)', color: '#ffd740' },
      { type: 'VSAT_TERMINAL', label: 'VSAT-терминал', color: '#b388ff' },
      { type: 'OFFLINE_QUEUE', label: 'Офлайн-очередь', color: '#69f0ae' },
    ],
  },
  {
    category: 'Кабели',
    types: [
      { type: 'CABLE_FIBER', label: 'Подводный оптовол.', color: CABLE_COLORS.CABLE_FIBER },
      { type: 'CABLE_COPPER', label: 'Подводный медный', color: CABLE_COLORS.CABLE_COPPER },
      { type: 'CABLE_UNDERGROUND_FIBER', label: 'Подземный оптовол.', color: CABLE_COLORS.CABLE_UNDERGROUND_FIBER },
      { type: 'CABLE_UNDERGROUND_COPPER', label: 'Подземный медный', color: CABLE_COLORS.CABLE_UNDERGROUND_COPPER },
    ],
  },
];

const CABLE_TYPES = new Set(['CABLE_UNDERGROUND_FIBER', 'CABLE_UNDERGROUND_COPPER', 'CABLE_FIBER', 'CABLE_COPPER']);
function isCable(type: string) { return CABLE_TYPES.has(type); }

let idCounter = 0;
function tempId() { return `sb-${++idCounter}-${Date.now()}`; }

function nodeColor(type: string): string {
  const v = NODE_VISUALS[type];
  if (!v) return '#ff9900';
  return '#' + v.color.toString(16).padStart(6, '0');
}

export default function SandboxPage() {
  const authorPubkey = useAuthorPubkey();
  const { connected, signMessage } = useWallet();

  const [elements, setElements] = useState<SandboxElement[]>([]);
  const [selectedType, setSelectedType] = useState<ElementType | null>(null);
  const [cableFromId, setCableFromId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('MAP_2D');
  const [showGlobalNetwork, setShowGlobalNetwork] = useState(false);
  const [network, setNetwork] = useState<NetworkResponseDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalDesc, setProposalDesc] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mapZoom, setMapZoom] = useState(6);
  /** Ref на карту не триггерит ре-рендер; без state D-pad не появлялся после init Leaflet. */
  const [map2DReady, setMap2DReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setSidebarOpen(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const leafletLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const selectedTypeRef = useRef(selectedType);
  selectedTypeRef.current = selectedType;
  const cableFromIdRef = useRef(cableFromId);
  cableFromIdRef.current = cableFromId;

  const savedCenterRef = useRef<{ lat: number; lng: number }>({
    lat: GLOBE_DEFAULT_CENTER.lat,
    lng: GLOBE_DEFAULT_CENTER.lng,
  });

  // 3D refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const sandboxGroupRef = useRef<THREE.Group | null>(null);
  const threeInitRef = useRef(false);
  const animFrameRef = useRef(0);
  const worldLabelCandidatesRef = useRef<GlobeLabelCandidate[]>([]);

  useEffect(() => {
    if (!showGlobalNetwork) { setNetwork(null); return; }
    fetch('/api/network?scope=GLOBAL')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setNetwork(data as NetworkResponseDTO); })
      .catch(() => {});
  }, [showGlobalNetwork]);

  // --- SEARCH ---
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=5`);
        if (res.ok) setSearchResults((await res.json()) as SearchResult[]);
      } catch { /* ignore */ }
      finally { setSearchLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleSelectSearch = useCallback((r: SearchResult) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (viewMode === 'MAP_2D' && mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 12);
    } else if (viewMode === 'GLOBE_3D' && globeGroupRef.current) {
      syncGlobeToMapCenter(globeGroupRef.current, lat, lng);
    }
    setSearchQuery('');
    setSearchResults([]);
  }, [viewMode]);

  // --- 2D MAP ---
  useEffect(() => {
    if (viewMode !== 'MAP_2D' || !mapContainerRef.current) return;
    if (mapInstanceRef.current) return;
    let cancelled = false;
    const layersForCleanup = leafletLayersRef.current;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapContainerRef.current) return;
      leafletRef.current = await import('leaflet');

      const c = savedCenterRef.current;
      const map = L.map(mapContainerRef.current, {
        center: [c.lat, c.lng],
        zoom: 6,
        zoomControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OSM',
        maxZoom: 18,
      }).addTo(map);

      map.on('zoomend', () => setMapZoom(map.getZoom()));

      map.on('click', (e: L.LeafletMouseEvent) => {
        const curType = selectedTypeRef.current;
        if (!curType) return;

        if (isCable(curType)) {
          const fromId = cableFromIdRef.current;
          if (!fromId) return;
          const curElements = elementsRef.current;
          const fromEl = curElements.find(el => el.tempId === fromId);
          if (!fromEl) return;

          const closest = findClosestNode(curElements, e.latlng.lat, e.latlng.lng, fromId);
          if (!closest) return;

          const cable: SandboxElement = {
            tempId: tempId(),
            type: curType,
            name: '',
            lat: fromEl.lat,
            lng: fromEl.lng,
            fromId,
            toId: closest.tempId,
          };
          setElements(prev => [...prev, cable]);
          setCableFromId(null);

          const color = CABLE_COLORS[curType] || '#ff9900';
          const isDashed = curType.includes('UNDERGROUND');
          const line = L.polyline(
            [[fromEl.lat, fromEl.lng], [closest.lat, closest.lng]],
            { color, weight: 3, dashArray: isDashed ? '8,6' : undefined },
          ).addTo(map);
          line.bindTooltip(curType.replace('CABLE_', '').replace('UNDERGROUND_', 'ПЗ '), { sticky: true });
          leafletLayersRef.current.set(cable.tempId, line);
        } else {
          const el: SandboxElement = {
            tempId: tempId(),
            type: curType,
            name: '',
            lat: e.latlng.lat,
            lng: e.latlng.lng,
          };
          setElements(prev => [...prev, el]);

          const c = nodeColor(curType);
          const marker = L.marker([e.latlng.lat, e.latlng.lng], {
            draggable: true,
            icon: L.divIcon({
              className: '',
              html: `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 0 4px ${c}"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            }),
          }).addTo(map);
          marker.bindPopup(curType);
          marker.bindTooltip(curType, { sticky: true });
          leafletLayersRef.current.set(el.tempId, marker);

          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            setElements(prev => prev.map(x =>
              x.tempId === el.tempId ? { ...x, lat: pos.lat, lng: pos.lng } : x
            ));
            updateCablesForNode(el.tempId, pos.lat, pos.lng);
          });

          marker.on('click', () => {
            if (isCable(selectedTypeRef.current || '')) {
              setCableFromId(el.tempId);
            }
          });
        }
      });

      mapInstanceRef.current = map;
      map.whenReady(() => {
        if (cancelled) return;
        setMap2DReady(true);
      });
    })();

    return () => {
      cancelled = true;
      setMap2DReady(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      layersForCleanup.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  function findClosestNode(els: SandboxElement[], lat: number, lng: number, excludeId: string): SandboxElement | null {
    let best: SandboxElement | null = null;
    let bestDist = Infinity;
    for (const el of els) {
      if (el.tempId === excludeId || isCable(el.type)) continue;
      const d = (el.lat - lat) ** 2 + (el.lng - lng) ** 2;
      if (d < bestDist) { bestDist = d; best = el; }
    }
    return bestDist < 25 ? best : null;
  }

  function updateCablesForNode(nodeId: string, lat: number, lng: number) {
    setElements(prev => prev.map(el => {
      if (!isCable(el.type)) return el;
      if (el.fromId === nodeId) {
        const updated = { ...el, lat };
        const layer = leafletLayersRef.current.get(el.tempId);
        if (layer && 'setLatLngs' in layer) {
          const toEl = prev.find(x => x.tempId === el.toId);
          if (toEl) (layer as L.Polyline).setLatLngs([[lat, lng], [toEl.lat, toEl.lng]]);
        }
        return { ...updated, lng };
      }
      if (el.toId === nodeId) {
        const layer = leafletLayersRef.current.get(el.tempId);
        if (layer && 'setLatLngs' in layer) {
          const fromEl = prev.find(x => x.tempId === el.fromId);
          if (fromEl) (layer as L.Polyline).setLatLngs([[fromEl.lat, fromEl.lng], [lat, lng]]);
        }
        return el;
      }
      return el;
    }));
  }

  // --- 3D GLOBE ---
  useEffect(() => {
    if (viewMode !== 'GLOBE_3D' || !threeContainerRef.current || threeInitRef.current) return;
    threeInitRef.current = true;
    const mount = threeContainerRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(GLOBE_SCENE_BACKGROUND_HEX);
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

    const starsGeo = new THREE.BufferGeometry();
    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 120 + Math.random() * 600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ size: 0.6, sizeAttenuation: true, color: 0x9fb3ff })));

    const globeGroup = new THREE.Group();
    globeGroupRef.current = globeGroup;

    const globeGeo = new THREE.SphereGeometry(1, sphereSegs, sphereSegs);
    const fallbackMat = new THREE.MeshPhongMaterial({ color: 0x24517e, emissive: 0x144d7a, shininess: 10, specular: 0x2f3b62 });
    globeGroup.add(new THREE.Mesh(globeGeo, fallbackMat));

    const cloudGeo = new THREE.SphereGeometry(1.012, sphereSegs, sphereSegs);
    const cloudMat = new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    globeGroup.add(new THREE.Mesh(cloudGeo, cloudMat));

    const sandboxGroup = new THREE.Group();
    sandboxGroupRef.current = sandboxGroup;
    globeGroup.add(sandboxGroup);
    scene.add(globeGroup);

    // Те же географические подписи, что на «Глобальной сети» (WORLD_LABELS).
    const worldLabelCandidates: GlobeLabelCandidate[] = [];
    for (const wl of WORLD_LABELS) {
      const labelR = wl.kind === 'water' ? 1.001 : 1.018;
      const pos = latLngToVec3(wl.lat, wl.lng, labelR);
      if (!pos) continue;
      const labelColor = wl.kind === 'water' ? '#80e0ff' : wl.kind === 'city' ? '#b0d4ff' : '#ffffff';
      const mesh = makeTextMesh(wl.text, pos, { color: labelColor, fontSize: wl.fontSize, kind: wl.kind });
      mesh.visible = false;
      globeGroup.add(mesh);
      const latRad = wl.lat * DEG2RAD;
      const lngRad = wl.lng * DEG2RAD;
      worldLabelCandidates.push({
        sprite: mesh,
        latRad,
        lngRad,
        sinLat: Math.sin(latRad),
        cosLat: Math.cos(latRad),
      });
    }
    worldLabelCandidatesRef.current = worldLabelCandidates;

    const c = savedCenterRef.current;
    syncGlobeToMapCenter(globeGroup, c.lat, c.lng);

    loadEarthTextures(renderer).then((set) => {
      if (!set) return;
      applyLoadedEarthTextures(
        globeGroup.children[0] as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshPhongMaterial | THREE.MeshStandardMaterial
        >,
        globeGroup.children[1] as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshPhongMaterial | THREE.MeshStandardMaterial
        >,
        set,
        materialMode,
      );
    });

    // Mouse drag rotation
    let dragging = false;
    let prevX = 0, prevY = 0;
    const onPointerDown = (e: PointerEvent) => {
      dragging = true; prevX = e.clientX; prevY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX; prevY = e.clientY;
      const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.005);
      const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.005);
      globeGroup.quaternion.premultiply(qx).premultiply(qy);
    };
    const onPointerUp = () => { dragging = false; };

    let zoomLevel = 3;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomLevel = Math.max(1.2, Math.min(6, zoomLevel + (e.deltaY > 0 ? 0.15 : -0.15)));
      camera.position.z = zoomLevel;
    };

    const raycaster = new THREE.Raycaster();
    const onClick = (e: MouseEvent) => {
      const curType = selectedTypeRef.current;
      if (!curType) return;
      const rect = mount.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      if (isCable(curType)) {
        const nodeChildren = sandboxGroup.children.filter(
          (ch) => ch.userData && ch.userData.tempId && ch.userData.elType,
        );
        const nodeHits = raycaster.intersectObjects(nodeChildren, true);
        if (nodeHits.length === 0) return;
        let hitObj = nodeHits[0].object;
        while (hitObj.parent && !hitObj.userData?.tempId) hitObj = hitObj.parent;
        if (!hitObj.userData?.tempId) return;
        const hitId = hitObj.userData.tempId as string;

        const fromId = cableFromIdRef.current;
        if (!fromId) {
          setCableFromId(hitId);
          return;
        }
        if (fromId === hitId) return;
        const curElements = elementsRef.current;
        const fromEl = curElements.find((x) => x.tempId === fromId);
        const toEl = curElements.find((x) => x.tempId === hitId);
        if (!fromEl || !toEl) return;
        const cable: SandboxElement = {
          tempId: tempId(),
          type: curType,
          name: '',
          lat: fromEl.lat,
          lng: fromEl.lng,
          fromId,
          toId: hitId,
        };
        setElements((prev) => [...prev, cable]);
        setCableFromId(null);
        return;
      }

      const hits = raycaster.intersectObject(globeGroup.children[0] as THREE.Mesh);
      if (hits.length === 0) return;
      const point = hits[0].point;
      const localPoint = globeGroup.worldToLocal(point.clone());
      const r = localPoint.length();
      const lat = 90 - Math.acos(localPoint.y / r) * (180 / Math.PI);
      const lng = Math.atan2(localPoint.z, -localPoint.x) * (180 / Math.PI) - 180;
      const normLng = lng < -180 ? lng + 360 : lng > 180 ? lng - 360 : lng;
      const el: SandboxElement = { tempId: tempId(), type: curType, name: '', lat, lng: normLng };
      setElements((prev) => [...prev, el]);
    };

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('wheel', onWheel, { passive: false });
    mount.addEventListener('click', onClick);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      updateGlobeFrontLabelsVisibility(worldLabelCandidatesRef.current, globeGroup, camera.position.z);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('wheel', onWheel);
      mount.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      threeInitRef.current = false;
      globeGroupRef.current = null;
      worldLabelCandidatesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Rebuild 3D sandbox elements
  useEffect(() => {
    if (viewMode !== 'GLOBE_3D' || !sandboxGroupRef.current) return;
    const group = sandboxGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeThreeObject(child);
    }

    const cableClipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.15);

    for (const el of elements) {
      if (isCable(el.type)) {
        const fromEl = elements.find(x => x.tempId === el.fromId);
        const toEl = elements.find(x => x.tempId === el.toId);
        if (!fromEl || !toEl) continue;
        const pts = [latLngToVec3(fromEl.lat, fromEl.lng, 1.002), latLngToVec3(toEl.lat, toEl.lng, 1.002)].filter(Boolean) as THREE.Vector3[];
        if (pts.length < 2) continue;
        const colorHex = parseInt((CABLE_COLORS[el.type] || '#ff9900').replace('#', ''), 16);
        const isDashed = el.type.includes('UNDERGROUND');
        const mat = isDashed
          ? new THREE.LineDashedMaterial({ color: colorHex, transparent: true, opacity: 0.8, dashSize: 0.04, gapSize: 0.03, clippingPlanes: [cableClipPlane] })
          : new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, clippingPlanes: [cableClipPlane] });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, mat);
        if (isDashed) line.computeLineDistances();
        line.frustumCulled = false;
        group.add(line);
        continue;
      }

      const visual = NODE_VISUALS[el.type];
      if (!visual) continue;
      const nodeR = el.type === 'SATELLITE' ? 1.0 + 550 / 6371 : 1.012 + (visual.size - 0.01) * 0.9;
      const pos = latLngToVec3(el.lat, el.lng, nodeR);
      if (!pos) continue;
      const normal = pos.clone().normalize();

      let marker: THREE.Object3D;
      if (el.type === 'SATELLITE') {
        marker = createSatelliteObject(visual.size, visual.color, visual.emissive);
      } else {
        const factory = EQUIPMENT_FACTORIES[el.type];
        marker = factory
          ? factory(visual.size, visual.color, visual.emissive)
          : createSatelliteObject(visual.size, visual.color, visual.emissive);
      }
      marker.position.copy(pos);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      marker.userData = { tempId: el.tempId, elType: el.type };
      group.add(marker);
    }

    if (showGlobalNetwork && network) {
      for (const el of network.elements) {
        if (el.path && (el.type === 'CABLE_FIBER' || el.type === 'CABLE_COPPER' || el.type === 'CABLE_UNDERGROUND_FIBER' || el.type === 'CABLE_UNDERGROUND_COPPER')) {
          const pts = el.path.map(p => latLngToVec3(p.lat, p.lng, 1.002)).filter(Boolean) as THREE.Vector3[];
          if (pts.length < 2) continue;
          const colorHex = el.type === 'CABLE_FIBER' ? 0x3a7bd5 : el.type === 'CABLE_COPPER' ? 0xd4a54a : el.type === 'CABLE_UNDERGROUND_FIBER' ? 0x00e676 : 0xff7043;
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.25 });
          const line = new THREE.Line(geo, mat);
          line.frustumCulled = false;
          group.add(line);
        } else if (typeof el.lat === 'number' && typeof el.lng === 'number') {
          const visual = NODE_VISUALS[el.type];
          if (!visual) continue;
          const nodeR = el.type === 'SATELLITE' ? 1.0 + 550 / 6371 : 1.012;
          const pos = latLngToVec3(el.lat, el.lng, nodeR);
          if (!pos) continue;
          const normal = pos.clone().normalize();
          const factory = EQUIPMENT_FACTORIES[el.type];
          const marker = factory ? factory(visual.size * 0.7, 0x666688, 0x222233) : createSatelliteObject(visual.size * 0.7, 0x666688, 0x222233);
          marker.position.copy(pos);
          marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
          group.add(marker);
        }
      }
    }
  }, [elements, viewMode, showGlobalNetwork, network]);

  // --- REMOVE ELEMENT ---
  const removeElement = useCallback((tid: string) => {
    const layer = leafletLayersRef.current.get(tid);
    if (layer && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(layer);
      leafletLayersRef.current.delete(tid);
    }
    setElements(prev => {
      const el = prev.find(e => e.tempId === tid);
      const updated = prev.filter(e => e.tempId !== tid);
      if (el && !isCable(el.type)) {
        const orphanCables = updated.filter(e => isCable(e.type) && (e.fromId === tid || e.toId === tid));
        for (const c of orphanCables) {
          const cLayer = leafletLayersRef.current.get(c.tempId);
          if (cLayer && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(cLayer);
            leafletLayersRef.current.delete(c.tempId);
          }
        }
        return updated.filter(e => !(isCable(e.type) && (e.fromId === tid || e.toId === tid)));
      }
      return updated;
    });
    if (cableFromId === tid) setCableFromId(null);
  }, [cableFromId]);

  // --- SAVE ---
  const handleSave = useCallback(async () => {
    if (!authorPubkey || elements.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const pRes = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'GLOBAL',
          authorPubkey,
          title: proposalTitle || 'Предложение сети',
          description: proposalDesc || undefined,
        }),
      });
      if (!pRes.ok) throw new Error(`Failed to create proposal: ${pRes.status}`);
      const proposal = await pRes.json();

      if (!signMessage) {
        setSaveError('Кошелёк не поддерживает подпись сообщений');
        setSaving(false);
        return;
      }
      // Must match `src/app/api/proposals/[id]/actions/route.ts` (same as /propose).
      const actionMessage = `diploma-z96a action:add:${proposal.id}`;
      const encoded = new TextEncoder().encode(actionMessage);
      const sig = await signMessage(encoded);
      const sigBase58 = bs58.encode(sig);

      for (const el of elements) {
        const payload: Record<string, unknown> = {
          type: el.type, scope: 'GLOBAL', name: el.name || el.type, lat: el.lat, lng: el.lng,
        };
        if (isCable(el.type) && el.fromId && el.toId) {
          const fromEl = elements.find(x => x.tempId === el.fromId);
          const toEl = elements.find(x => x.tempId === el.toId);
          if (fromEl && toEl) {
            payload.path = [{ lat: fromEl.lat, lng: fromEl.lng }, { lat: toEl.lat, lng: toEl.lng }];
          }
        }
        const aRes = await fetch(`/api/proposals/${proposal.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionType: 'CREATE', elementPayload: payload, authorPubkey, signature: sigBase58 }),
        });
        if (!aRes.ok) {
          const errJson = (await aRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errJson?.error || `Не удалось добавить действие: HTTP ${aRes.status}`);
        }
      }

      const submitRes = await fetch(`/api/proposals/${proposal.id}/submit-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorPubkey }),
      });
      if (!submitRes.ok) {
        const errJson = (await submitRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errJson?.error || `Не удалось отправить на голосование: HTTP ${submitRes.status}`);
      }

      setSaveSuccess(`Предложение отправлено на голосование! Перейдите в "Предложения" для просмотра.`);
      setShowSaveModal(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [authorPubkey, elements, proposalTitle, proposalDesc, signMessage]);

  const handleZoom = useCallback((delta: number) => {
    if (viewMode === 'MAP_2D' && mapInstanceRef.current) {
      mapInstanceRef.current.setZoom(mapInstanceRef.current.getZoom() + delta);
    } else if (viewMode === 'GLOBE_3D' && cameraRef.current) {
      const z = Math.max(1.2, Math.min(6, cameraRef.current.position.z - delta * 0.5));
      cameraRef.current.position.z = z;
    }
  }, [viewMode]);

  const nodeElements = elements.filter(e => !isCable(e.type));
  const cableElements = elements.filter(e => isCable(e.type));

  return (
    <div className="sandbox-root" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex' }}>
      <style>{`
        .sandbox-root { min-height: 100vh; }
        .sandbox-sidebar {
          width: 280px;
          flex-shrink: 0;
          padding: 60px 12px 12px;
          border-right: 1px solid rgba(232,236,255,0.10);
          overflow-y: auto;
          background: var(--bg);
        }
        .sandbox-map-area {
          flex: 1;
          position: relative;
          min-width: 0;
          padding-top: 52px;
        }
        .sandbox-backdrop {
          display: none;
        }
        .sandbox-toggle-btn {
          display: none;
        }
        @media (max-width: 767px) {
          .sandbox-sidebar {
            position: fixed;
            left: 0;
            top: 52px;
            bottom: 0;
            width: 280px;
            z-index: 500;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
            box-shadow: 4px 0 24px rgba(0,0,0,0.35);
          }
          .sandbox-sidebar.sandbox-sidebar--open {
            transform: translateX(0);
          }
          .sandbox-map-area {
            padding-top: 0;
            flex: 1;
            width: 100%;
          }
          .sandbox-backdrop {
            display: block;
            position: fixed;
            left: 0;
            right: 0;
            top: 52px;
            bottom: 0;
            z-index: 499;
            background: rgba(0,0,0,0.45);
            cursor: pointer;
          }
          .sandbox-toggle-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            position: fixed;
            bottom: 70px;
            right: 12px;
            z-index: 600;
            width: 44px;
            height: 44px;
            border-radius: 12px;
            border: 1px solid rgba(232,236,255,0.15);
            background: rgba(10,20,40,0.92);
            color: #fff;
            font-size: 20px;
            line-height: 1;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.35);
          }
        }
        @media (min-width: 768px) {
          .sandbox-backdrop {
            display: none !important;
          }
        }
      `}</style>
      {sidebarOpen && (
        <div
          className="sandbox-backdrop"
          role="presentation"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Left toolbar */}
      <div className={`sandbox-sidebar ${sidebarOpen ? 'sandbox-sidebar--open' : ''}`}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Песочница</h2>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          Выберите элемент, кликните на карту/глобус. Для кабелей: выберите тип кабеля, кликните на первый узел, затем на второй.
        </p>

        {/* Search */}
        <div style={{ marginBottom: 12, position: 'relative' }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск поселения..."
            style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(232,236,255,0.15)', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'rgba(18,22,40,0.98)', border: '1px solid rgba(232,236,255,0.15)', borderRadius: 8, maxHeight: 150, overflowY: 'auto', zIndex: 100 }}>
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => handleSelectSearch(r)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 11, cursor: 'pointer' }}
                >
                  {r.display_name?.slice(0, 80) || `${r.lat}, ${r.lon}`}
                </button>
              ))}
            </div>
          )}
          {searchLoading && <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 10, color: 'var(--muted)' }}>...</span>}
        </div>

        {/* Element types */}
        {ELEMENT_TYPES.map((cat) => (
          <div key={cat.category} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>
              {cat.category}
            </div>
            {cat.types.map((t) => (
              <button
                key={t.type}
                onClick={() => { setSelectedType(selectedType === t.type ? null : t.type); setCableFromId(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', textAlign: 'left', padding: '5px 10px', marginBottom: 1,
                  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
                  color: selectedType === t.type ? '#fff' : 'var(--text)',
                  background: selectedType === t.type ? 'rgba(120,160,255,0.25)' : 'transparent',
                }}
              >
                {t.color && <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />}
                {t.label}
              </button>
            ))}
          </div>
        ))}

        {selectedType && isCable(selectedType) && (
          <div style={{ fontSize: 11, color: '#ffcc00', marginBottom: 8, padding: '4px 10px', background: 'rgba(255,204,0,0.1)', borderRadius: 6 }}>
            {cableFromId
              ? 'Кликните на второй узел для завершения кабеля'
              : 'Кликните на узел (начало кабеля)'}
          </div>
        )}

        {/* Toggle */}
        <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
          <Button onClick={() => {
            if (globeGroupRef.current) {
              const ctr = getFrontGlobeCenterLatLng(globeGroupRef.current);
              if (ctr) savedCenterRef.current = ctr;
            }
            setViewMode('MAP_2D');
          }} disabled={viewMode === 'MAP_2D'}>2D</Button>
          <Button onClick={() => {
            if (mapInstanceRef.current) {
              const ctr = mapInstanceRef.current.getCenter();
              savedCenterRef.current = { lat: ctr.lat, lng: ctr.lng };
            }
            setViewMode('GLOBE_3D');
          }} disabled={viewMode === 'GLOBE_3D'}>3D</Button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', cursor: 'pointer', marginTop: 10 }}>
          <input type="checkbox" checked={showGlobalNetwork} onChange={(e) => setShowGlobalNetwork(e.target.checked)} />
          Показать глобальную сеть
        </label>

        {/* My Elements */}
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(232,236,255,0.10)', paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Узлы ({nodeElements.length})
          </div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {nodeElements.map((el) => (
              <div key={el.tempId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 6px', fontSize: 11, color: 'var(--muted)', borderRadius: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: nodeColor(el.type), flexShrink: 0 }} />
                  {el.type} ({el.lat.toFixed(2)}, {el.lng.toFixed(2)})
                </span>
                <button onClick={() => removeElement(el.tempId)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: 11 }}>x</button>
              </div>
            ))}
          </div>
          {cableElements.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginTop: 8, marginBottom: 4 }}>
                Кабели ({cableElements.length})
              </div>
              <div style={{ maxHeight: 80, overflowY: 'auto' }}>
                {cableElements.map((el) => (
                  <div key={el.tempId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 6px', fontSize: 11, color: 'var(--muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 4, borderRadius: 1, background: CABLE_COLORS[el.type] || '#ff9900', flexShrink: 0 }} />
                      {el.type.replace('CABLE_', '').replace('UNDERGROUND_', 'ПЗ ')}
                    </span>
                    <button onClick={() => removeElement(el.tempId)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: 11 }}>x</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Save */}
        <div style={{ marginTop: 14 }}>
          {connected ? (
            <Button onClick={() => setShowSaveModal(true)} disabled={elements.length === 0}>
              Сохранить как предложение
            </Button>
          ) : (
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>Подключите кошелёк для сохранения</p>
          )}
        </div>
        {saveError && <p style={{ fontSize: 11, color: '#ff6b6b', marginTop: 6 }}>{saveError}</p>}
        {saveSuccess && <p style={{ fontSize: 11, color: '#3ddc97', marginTop: 6 }}>{saveSuccess}</p>}

      </div>

      <button
        type="button"
        className="sandbox-toggle-btn"
        onClick={() => setSidebarOpen(o => !o)}
        aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? 'Скрыть панель' : 'Показать панель'}
      >
        ☰
      </button>

      {/* Map / Globe area */}
      <div className="sandbox-map-area">
        {viewMode === 'MAP_2D' && <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />}
        {viewMode === 'GLOBE_3D' && <div ref={threeContainerRef} style={{ width: '100%', height: '100%' }} />}

        {/* Custom zoom */}
        <div style={{ position: 'absolute', bottom: 20, left: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={() => handleZoom(1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(232,236,255,0.15)', background: 'rgba(10,20,40,0.85)', color: '#fff', fontSize: 18, cursor: 'pointer' }}>+</button>
          <button onClick={() => handleZoom(-1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(232,236,255,0.15)', background: 'rgba(10,20,40,0.85)', color: '#fff', fontSize: 18, cursor: 'pointer' }}>&minus;</button>
        </div>

        {selectedType && (
          <div style={{ position: 'absolute', top: 62, left: '50%', transform: 'translateX(-50%)', background: 'rgba(10,20,40,0.9)', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#ffcc00', zIndex: 1000, pointerEvents: 'none' }}>
            Размещение: {ELEMENT_TYPES.flatMap(c => c.types).find(t => t.type === selectedType)?.label ?? selectedType}
            {isCable(selectedType) ? ' (кликните на узлы)' : ' (клик на карту/глобус)'}
          </div>
        )}

        {viewMode === 'MAP_2D' && map2DReady && (
          <div style={{ position: 'absolute', bottom: 70, left: 12, zIndex: 1000, display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gap: 2 }}>
            {[
              { label: '↖', dx: -100, dy: -100 },
              { label: '↑', dx: 0, dy: -100 },
              { label: '↗', dx: 100, dy: -100 },
              { label: '←', dx: -100, dy: 0 },
              { label: '·', dx: 0, dy: 0 },
              { label: '→', dx: 100, dy: 0 },
              { label: '↙', dx: -100, dy: 100 },
              { label: '↓', dx: 0, dy: 100 },
              { label: '↘', dx: 100, dy: 100 },
            ].map((d) => (
              <button
                key={d.label}
                onClick={() => { if (d.dx || d.dy) mapInstanceRef.current?.panBy([d.dx, d.dy]); }}
                disabled={!d.dx && !d.dy}
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  border: '1px solid rgba(232,236,255,0.15)',
                  background: (!d.dx && !d.dy) ? 'transparent' : 'rgba(10,20,40,0.85)',
                  color: '#fff', fontSize: 12, cursor: (d.dx || d.dy) ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={() => setShowSaveModal(false)}>
          <div style={{ background: 'var(--bg, #0b1020)', border: '1px solid rgba(232,236,255,0.15)', borderRadius: 14, padding: '28px 32px', maxWidth: 440, width: '90%' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Сохранить предложение</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Название</label>
              <input value={proposalTitle} onChange={e => setProposalTitle(e.target.value)} placeholder="Устойчивая сеть для Мозырского района"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(232,236,255,0.15)', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: 14, outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Описание</label>
              <textarea value={proposalDesc} onChange={e => setProposalDesc(e.target.value)} placeholder="Опишите архитектуру..." rows={3}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(232,236,255,0.15)', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: 14, outline: 'none', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Сохранение...' : `Сохранить (${elements.length} эл.)`}</Button>
              <Button onClick={() => setShowSaveModal(false)}>Отмена</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
