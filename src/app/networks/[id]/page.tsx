'use client';
// Страница /networks/[id] — UI Next.js App Router.


import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import Link from 'next/link';
import { EQUIPMENT_FACTORIES, NODE_VISUALS, CABLE_COLORS, TYPE_LABELS_RU, createSatelliteObject } from '@/lib/three/factories';
import { latLngToVec3, orientGlobeGroupCenterFromLatLng, makeTextMesh, disposeThreeObject, computeGlobeCenterLatLng } from '@/lib/three/utils';
import { attachGlobeTrackballControls } from '@/lib/three/globeTrackballControls';
import { applyGlobeZoomDelta } from '@/lib/three/globeZoom';
import { WORLD_LABELS } from '@/lib/three/labels';
import { getEarthMaterialMode, getEarthSphereSegments } from '@/lib/earthQuality';
import { loadEarthTextures } from '@/lib/loadEarthTextures';
import {
  GLOBE_SCENE_BACKGROUND_HEX,
  GLOBE_DEFAULT_CENTER,
  applyLoadedEarthTextures,
  updateGlobeFrontLabelsVisibility,
  type GlobeLabelCandidate,
} from '@/lib/three/globeAppearance';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { ProposalCollapsibleLegend } from '@/components/networks/ProposalLegend';
import { colors } from '@/theme/colors';
import { useSessionVerified } from '@/hooks/useSessionVerified';
import { foldProposalActionsForDisplay } from '@/lib/stage7/proposalActionFold';
import {
  DIGITAL_RUBLE_MINSK_LEGEND_GROUP,
  NETWORK_LEGEND_GROUPS,
} from '@/lib/networkLegend/registry';
import { isDigitalRubleMinskScenario } from '@/lib/networkLegend/scenarioDetection';
import { buildProposalNodeDivIcon } from '@/lib/leaflet/proposalNodeIcons';
import type L from 'leaflet';

type ViewMode = 'GLOBE_3D' | 'MAP_2D';

type ProposalData = {
  id: string;
  title: string | null;
  description: string | null;
  authorPubkey: string;
  status: string;
  forkedFromProposalId?: string | null;
  createdAt: string;
  votingEndsAt: string | null;
  actions: ActionData[];
  _count?: { votes?: number; revisions?: number; forksFromThis?: number };
};

type ActionData = {
  id: string;
  actionType: string;
  targetElementId?: string | null;
  elementPayload: Record<string, unknown>;
};

type VoteTally = { for: number; against: number; total: number; userVote: string | null };

type SearchResult = { lat: string; lon: string; display_name?: string };

type RevisionListItem = {
  id: string;
  parentRevisionId: string | null;
  authorPubkey: string;
  message: string;
  diffSummary: { added?: number; removed?: number; changed?: number } | null;
  isBaseline: boolean;
  createdAt: string;
};

const DEG2RAD = Math.PI / 180;
const GLOBE_ZOOM_MIN = 1.2;
const GLOBE_ZOOM_MAX = 6;
const GLOBE_ZOOM_STEP = 0.25;
const MAP_ZOOM_MIN = 2;
const MAP_ZOOM_MAX = 19;

function isCableType(t: string) {
  return t === 'CABLE_FIBER' || t === 'CABLE_COPPER' || t === 'CABLE_UNDERGROUND_FIBER' || t === 'CABLE_UNDERGROUND_COPPER';
}

function linkMetadataRecord(el: Record<string, unknown>): Record<string, unknown> | null {
  const m = el.metadata;
  if (typeof m === 'object' && m !== null && !Array.isArray(m)) return m as Record<string, unknown>;
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** Центр bbox и «размах» сети в градусах — по узлам и точкам кабелей. */
function computeProposalNetworkBounds(elements: Record<string, unknown>[]): {
  center: { lat: number; lng: number };
  diagDeg: number;
} | null {
  const points: Array<{ lat: number; lng: number }> = [];
  for (const el of elements) {
    if (typeof el.lat === 'number' && typeof el.lng === 'number') {
      points.push({ lat: el.lat, lng: el.lng });
    }
    if (Array.isArray(el.path)) {
      for (const pt of el.path) {
        const p = asRecord(pt);
        if (!p) continue;
        const lat = p.lat;
        const lng = p.lng;
        if (typeof lat === 'number' && typeof lng === 'number') {
          points.push({ lat, lng });
        }
      }
    }
  }
  if (points.length === 0) return null;
  let minLat = points[0]!.lat;
  let minLng = points[0]!.lng;
  let maxLat = points[0]!.lat;
  let maxLng = points[0]!.lng;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLat = Math.max(maxLat, p.lat);
    maxLng = Math.max(maxLng, p.lng);
  }
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const diagDeg = Math.hypot(maxLat - minLat, maxLng - minLng);
  return { center, diagDeg };
}

function suggestInitialGlobeZoomForNetwork(diagDeg: number) {
  if (diagDeg < 0.02) return 1.25;
  const raw = 1.2 + diagDeg * 1.2;
  return Math.max(GLOBE_ZOOM_MIN, Math.min(GLOBE_ZOOM_MAX, raw));
}

export default function ProposalViewPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { publicKey, signMessage } = useWallet();
  const pubkey = publicKey?.toBase58() ?? '';
  const sessionVerified = useSessionVerified();

  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [tally, setTally] = useState<VoteTally | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('GLOBE_3D');
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string>('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<RevisionListItem[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [displayGlobeZoom, setDisplayGlobeZoom] = useState(3);
  const [mapZoomDisplay, setMapZoomDisplay] = useState(6);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const networkGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animFrameRef = useRef(0);
  const threeInitRef = useRef(false);
  const mapInitRef = useRef(false);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const zoomLevelRef = useRef(3);
  const savedCenterRef = useRef<{ lat: number; lng: number }>({
    lat: GLOBE_DEFAULT_CENTER.lat,
    lng: GLOBE_DEFAULT_CENTER.lng,
  });
  const map2DZoom12FromGlobeRef = useRef(false);
  /** После первого кадрирования 3D под сеть для данного proposal.id не перезаписывать центр при 3D↔2D. */
  const lastGlobeFramedProposalIdRef = useRef<string | null>(null);

  const labelCandidatesRef = useRef<GlobeLabelCandidate[]>([]);

  useEffect(() => {
    lastGlobeFramedProposalIdRef.current = null;
  }, [id]);

  // Load proposal
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/proposals/${id}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/proposals/${id}/vote?voterPubkey=${pubkey}`).then(r => r.ok ? r.json() : null),
    ]).then(([p, t]) => {
      if (p) {
        setProposal(p as ProposalData);
        fetch('/api/profile/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pubkeys: [p.authorPubkey] }),
        }).then(r => r.ok ? r.json() : {}).then((m: Record<string, string>) => {
          const name = m[p.authorPubkey as string];
          if (name) setAuthorName(name);
        }).catch(() => {});
      } else {
        setError('Предложение не найдено');
      }
      if (t) setTally(t as VoteTally);
    }).catch(e => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [id, pubkey]);

  useEffect(() => {
    if (!id || !isDetailsOpen) return;
    let cancelled = false;
    setRevisionsLoading(true);
    fetch(`/api/proposals/${encodeURIComponent(id)}/revisions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown) => {
        if (!cancelled && Array.isArray(rows)) setRevisions(rows as RevisionListItem[]);
      })
      .catch(() => {
        if (!cancelled) setRevisions([]);
      })
      .finally(() => {
        if (!cancelled) setRevisionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isDetailsOpen]);

  // Search
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
      mapInstanceRef.current.flyTo([lat, lng], 12);
    } else if (viewMode === 'GLOBE_3D' && globeGroupRef.current) {
      orientGlobeGroupCenterFromLatLng(globeGroupRef.current, lat, lng);
    }
    setSearchQuery('');
    setSearchResults([]);
  }, [viewMode]);

  const handleVote = useCallback(async (voteType: 'FOR' | 'AGAINST') => {
    if (!publicKey || !signMessage || !id || !sessionVerified) return;
    setVoting(true); setVoteError(null);
    try {
      const message = `diploma-z96a vote:${id}:${voteType.toLowerCase()}`;
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await signMessage(msgBytes);
      const signature = bs58.encode(sigBytes);
      const res = await fetch(`/api/proposals/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voteType, voterPubkey: pubkey, signature }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      const tallyRes = await fetch(`/api/proposals/${id}/vote?voterPubkey=${pubkey}`);
      if (tallyRes.ok) setTally(await tallyRes.json());
    } catch (e: unknown) {
      setVoteError(e instanceof Error ? e.message : 'Ошибка');
    } finally { setVoting(false); }
  }, [publicKey, signMessage, id, pubkey, sessionVerified]);

  const handleWithdraw = useCallback(async () => {
    if (!publicKey || !signMessage || !id || !proposal || !sessionVerified) return;
    if (
      !window.confirm(
        'Снять предложение с голосования? Оно исчезнет из списка активных предложений. Безвозвратное удаление из базы — только в личном кабинете.',
      )
    ) {
      return;
    }
    setWithdrawBusy(true);
    setWithdrawErr(null);
    try {
      const message = `diploma-z96a propose:withdraw:${id}`;
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      const res = await fetch(`/api/proposals/${encodeURIComponent(id)}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorPubkey: pubkey, signature: bs58.encode(sigBytes) }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        proposal?: { status?: string };
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        let msg = j.error || `HTTP ${res.status}`;
        if (j.code === 'SCHEMA_ENUM_MISSING') {
          msg =
            'На сервере не применены миграции БД (статус WITHDRAWN). Обратитесь к администратору или выполните prisma migrate deploy.';
        }
        throw new Error(msg);
      }
      if (j.proposal?.status) {
        setProposal(prev => (prev ? { ...prev, status: j.proposal!.status! } : prev));
      } else {
        setProposal(prev => (prev ? { ...prev, status: 'WITHDRAWN' } : prev));
      }
      setTally(null);
    } catch (e: unknown) {
      setWithdrawErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setWithdrawBusy(false);
    }
  }, [publicKey, signMessage, id, proposal, sessionVerified, pubkey]);

  const proposalElements = useMemo(
    () =>
      proposal?.actions?.length ?
        foldProposalActionsForDisplay(
          proposal.actions.map(a => ({
            id: a.id,
            actionType: a.actionType,
            targetElementId: a.targetElementId,
            elementPayload: a.elementPayload,
          })),
        )
      : [],
    [proposal],
  );

  const legendGroups = useMemo(
    () =>
      isDigitalRubleMinskScenario(proposalElements as Record<string, unknown>[]) ?
        [...NETWORK_LEGEND_GROUPS, DIGITAL_RUBLE_MINSK_LEGEND_GROUP]
      : NETWORK_LEGEND_GROUPS,
    [proposalElements],
  );

  const getGlobeCenterLatLng = useCallback((): { lat: number; lng: number } => {
    if (globeGroupRef.current) {
      return computeGlobeCenterLatLng(globeGroupRef.current) ?? {
        lat: GLOBE_DEFAULT_CENTER.lat,
        lng: GLOBE_DEFAULT_CENTER.lng,
      };
    }
    return { lat: GLOBE_DEFAULT_CENTER.lat, lng: GLOBE_DEFAULT_CENTER.lng };
  }, []);

  const handleToggleView = useCallback((target: ViewMode) => {
    if (target === viewMode) return;
    if (target === 'MAP_2D') {
      savedCenterRef.current = getGlobeCenterLatLng();
      map2DZoom12FromGlobeRef.current = true;
      setViewMode('MAP_2D');
      threeInitRef.current = false;
    } else {
      if (mapInstanceRef.current) {
        const c = mapInstanceRef.current.getCenter();
        savedCenterRef.current = { lat: c.lat, lng: c.lng };
      }
      setViewMode('GLOBE_3D');
    }
  }, [viewMode, getGlobeCenterLatLng]);

  // --- 3D GLOBE ---
  useEffect(() => {
    if (viewMode !== 'GLOBE_3D' || !threeContainerRef.current || threeInitRef.current || !proposal) return;
    threeInitRef.current = true;
    labelCandidatesRef.current = [];
    const mount = threeContainerRef.current;

    const bounds = computeProposalNetworkBounds(proposalElements as Record<string, unknown>[]);
    if (bounds && lastGlobeFramedProposalIdRef.current !== proposal.id) {
      savedCenterRef.current = bounds.center;
      zoomLevelRef.current = suggestInitialGlobeZoomForNetwork(bounds.diagDeg);
      lastGlobeFramedProposalIdRef.current = proposal.id;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(GLOBE_SCENE_BACKGROUND_HEX);

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    camera.position.set(0, 0, zoomLevelRef.current);
    cameraRef.current = camera;
    setDisplayGlobeZoom(zoomLevelRef.current);

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

    const hemi = new THREE.HemisphereLight(0x6b8cff, 0x081022, materialMode === 'standard' ? 0.78 : 0.72);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0xffffff, materialMode === 'standard' ? 0.52 : 0.42);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, materialMode === 'standard' ? 4.05 : 3.8);
    sun.position.set(4.5, 2.2, 5);
    scene.add(sun);

    const starsGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const r = 120 + Math.random() * 600;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(p) * Math.cos(t);
      positions[i * 3 + 1] = r * Math.cos(p);
      positions[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ size: 0.6, sizeAttenuation: true, color: 0x9fb3ff })));

    const globeGroup = new THREE.Group();
    globeGroupRef.current = globeGroup;

    const globeGeo = new THREE.SphereGeometry(1, sphereSegs, sphereSegs);
    const fallbackMat = new THREE.MeshPhongMaterial({ color: 0x24517e, emissive: 0x144d7a, shininess: 10, specular: 0x2f3b62 });
    globeGroup.add(new THREE.Mesh(globeGeo, fallbackMat));
    globeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.012, sphereSegs, sphereSegs), new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide })));

    const networkGroup = new THREE.Group();
    networkGroupRef.current = networkGroup;
    globeGroup.add(networkGroup);
    scene.add(globeGroup);

    orientGlobeGroupCenterFromLatLng(globeGroup, savedCenterRef.current.lat, savedCenterRef.current.lng);

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

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.15);

    // Render proposal elements with 3D factories
    for (const el of proposalElements) {
      const type = el.type as string;
      if (isCableType(type) && Array.isArray(el.path)) {
        const pts = (el.path as Array<{ lat: number; lng: number }>)
          .map(p => latLngToVec3(p.lat, p.lng, 1.002))
          .filter(Boolean) as THREE.Vector3[];
        if (pts.length < 2) continue;
        const meta = linkMetadataRecord(el);
        const linkKind = meta && typeof meta.linkKind === 'string' ? meta.linkKind : undefined;
        const isSatelliteLink = linkKind === 'satellite';
        const baseColor = isSatelliteLink ? '#8ab4f8' : (CABLE_COLORS[type] || '#ff9900');
        const colorHex = parseInt(baseColor.replace('#', ''), 16);
        const isDashed = isSatelliteLink || type.includes('UNDERGROUND');
        const mat = isDashed
          ? new THREE.LineDashedMaterial({
              color: colorHex,
              transparent: true,
              opacity: 0.85,
              dashSize: isSatelliteLink ? 0.02 : 0.04,
              gapSize: isSatelliteLink ? 0.05 : 0.03,
              clippingPlanes: [clipPlane],
            })
          : new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, clippingPlanes: [clipPlane] });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, mat);
        if (isDashed) line.computeLineDistances();
        line.frustumCulled = false;
        const stepLabel3d = meta && typeof meta.stepLabel === 'string' ? meta.stepLabel : '';
        line.userData = { elName: el.name, elType: type, stepLabel: stepLabel3d };
        networkGroup.add(line);
      } else if (typeof el.lat === 'number' && typeof el.lng === 'number') {
        const visual = NODE_VISUALS[type];
        if (!visual) continue;

        let altitudeKm = 0;
        if (typeof el.altitude === 'number' && Number.isFinite(el.altitude as number)) altitudeKm = el.altitude as number;
        else if (type === 'SATELLITE' || type === 'SATELLITE_RASSVET') altitudeKm = 550;
        const nodeR =
          type === 'SATELLITE' || type === 'SATELLITE_RASSVET' ? 1.0 + altitudeKm / 6371 : 1.012 + (visual.size - 0.01) * 0.9;

        const pos = latLngToVec3(el.lat as number, el.lng as number, nodeR);
        if (!pos) continue;
        const normal = pos.clone().normalize();

        let marker: THREE.Object3D;
        if (type === 'SATELLITE' || type === 'SATELLITE_RASSVET') {
          marker = createSatelliteObject(visual.size, visual.color, visual.emissive);
        } else {
          const factory = EQUIPMENT_FACTORIES[type];
          if (factory) {
            marker = factory(visual.size, visual.color, visual.emissive);
          } else {
            marker = createSatelliteObject(visual.size, visual.color, visual.emissive);
          }
        }
        marker.position.copy(pos);
        marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        marker.userData = { elName: el.name, elType: type };
        networkGroup.add(marker);
      }
    }

    // World labels (surface-lying meshes)
    for (const wl of WORLD_LABELS) {
      const labelR = wl.kind === 'water' ? 1.001 : 1.018;
      const pos = latLngToVec3(wl.lat, wl.lng, labelR);
      if (!pos) continue;
      const labelColor = wl.kind === 'water' ? '#80e0ff' : wl.kind === 'city' ? '#b0d4ff' : '#ffffff';
      const mesh = makeTextMesh(wl.text, pos, { color: labelColor, fontSize: wl.fontSize, kind: wl.kind });
      mesh.visible = false;
      networkGroup.add(mesh);

      const latRad = wl.lat * DEG2RAD;
      const lngRad = wl.lng * DEG2RAD;
      labelCandidatesRef.current.push({ sprite: mesh, latRad, lngRad, sinLat: Math.sin(latRad), cosLat: Math.cos(latRad) });
    }

    const globeEarthMesh = globeGroup.children[0] as THREE.Mesh;
    const trackball = attachGlobeTrackballControls({
      domElement: renderer.domElement,
      globeGroup,
      globeMesh: globeEarthMesh,
      camera,
      zoomMin: GLOBE_ZOOM_MIN,
      zoomMax: GLOBE_ZOOM_MAX,
      onZoomApplied: (z) => {
        zoomLevelRef.current = z;
        setDisplayGlobeZoom(z);
      },
    });

    // Tooltip
    const tooltipDiv = document.createElement('div');
    tooltipDiv.style.cssText =
      'position:fixed;z-index:9999;pointer-events:none;display:none;background:rgba(10,20,45,0.95);border:1px solid rgba(120,160,255,0.3);border-radius:8px;padding:6px 12px;font-size:12px;color:#eaf2ff;max-width:240px;backdrop-filter:blur(6px)';
    document.body.appendChild(tooltipDiv);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.012 };
    const camPos = new THREE.Vector3();
    const onMouseMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      camera.getWorldPosition(camPos);
      const hits = raycaster.intersectObjects(networkGroup.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        if (obj.userData?.__worldLabel) continue;
        while (obj && !obj.userData?.elType && obj.parent && obj.parent !== networkGroup) obj = obj.parent;
        if (!obj?.userData?.elType) continue;

        const isLine =
          hit.object instanceof THREE.Line ||
          hit.object instanceof THREE.LineLoop ||
          hit.object instanceof THREE.LineSegments;
        if (isLine) {
          const p = hit.point.clone().normalize();
          const v = camPos.clone().normalize();
          if (p.dot(v) < 0.12) continue;
        }

        const t = obj.userData.elType as string;
        const label = TYPE_LABELS_RU[t] || t;
        const name = obj.userData.elName || '';
        const stepL = typeof obj.userData.stepLabel === 'string' ? obj.userData.stepLabel : '';
        tooltipDiv.innerHTML = `<b>${label}</b>${name ? `<br/>${name}` : ''}${stepL ? `<br/>${stepL}` : ''}`;
        tooltipDiv.style.display = 'block';
        tooltipDiv.style.left = `${e.clientX + 12}px`;
        tooltipDiv.style.top = `${e.clientY + 12}px`;
        return;
      }
      tooltipDiv.style.display = 'none';
    };

    mount.addEventListener('mousemove', onMouseMove);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      updateGlobeFrontLabelsVisibility(labelCandidatesRef.current, globeGroup, camera.position.z);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => { camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight); };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      trackball.detach();
      mount.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      if (tooltipDiv.parentNode) tooltipDiv.parentNode.removeChild(tooltipDiv);
      renderer.dispose();
      if (networkGroupRef.current) {
        for (const child of [...networkGroupRef.current.children]) disposeThreeObject(child);
      }
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      threeInitRef.current = false;
      labelCandidatesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, proposal]);

  // --- 2D MAP ---
  useEffect(() => {
    if (viewMode !== 'MAP_2D' || !mapContainerRef.current || mapInitRef.current || !proposal) return;
    mapInitRef.current = true;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      leafletRef.current = await import('leaflet');
      if (cancelled || !mapContainerRef.current) return;

      const initCenter = savedCenterRef.current;
      const map = L.map(mapContainerRef.current, {
        center: [initCenter.lat, initCenter.lng],
        zoom: 6,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '', maxZoom: 18 }).addTo(map);
      mapInstanceRef.current = map;

      map.whenReady(() => {
        const syncMapZoom = () => setMapZoomDisplay(map.getZoom());
        map.on('zoomend', syncMapZoom);
        syncMapZoom();
        map.invalidateSize();
        if (map2DZoom12FromGlobeRef.current) {
          const c = savedCenterRef.current;
          map.setView([c.lat, c.lng], 12);
          map2DZoom12FromGlobeRef.current = false;
        }
        queueMicrotask(syncMapZoom);

        for (const el of proposalElements) {
          const type = el.type as string;
          if (isCableType(type) && Array.isArray(el.path)) {
            const pts = (el.path as Array<{ lat: number; lng: number }>).map(p => [p.lat, p.lng] as [number, number]);
            if (pts.length < 2) continue;
            const m2d = linkMetadataRecord(el);
            const linkKind2d = m2d && typeof m2d.linkKind === 'string' ? m2d.linkKind : undefined;
            const isSatelliteLink2d = linkKind2d === 'satellite';
            const color = isSatelliteLink2d ? '#8ab4f8' : (CABLE_COLORS[type] || '#ff9900');
            const isDashed = isSatelliteLink2d || type.includes('UNDERGROUND');
            const dashTop = isSatelliteLink2d ? '2,6' : (isDashed ? '8,6' : undefined);
            const dashShadow = isSatelliteLink2d ? '3,7' : (isDashed ? '9,7' : undefined);
            const step2d = m2d && typeof m2d.stepLabel === 'string' ? m2d.stepLabel : '';
            // Keep map mode visually volumetric: dark underlay + bright top cable.
            const cableShadow = L.polyline(pts, {
              color: '#071120',
              weight: 6,
              opacity: 0.24,
              dashArray: dashShadow,
            }).addTo(map);
            const cableMain = L.polyline(pts, {
              color,
              weight: 3,
              opacity: 0.92,
              dashArray: dashTop,
            }).addTo(map)
              .bindPopup(
                `<b>${TYPE_LABELS_RU[type] || type}</b>${el.name ? `<br/>${el.name}` : ''}${
                  step2d ? `<br/>${step2d}` : ''
                }`,
              )
              .bindTooltip(el.type as string, { sticky: true });
            cableShadow.bringToBack();
            cableMain.bringToFront();
          } else if (typeof el.lat === 'number' && typeof el.lng === 'number') {
            const m2d = linkMetadataRecord(el);
            const role = m2d && typeof m2d.role === 'string' ? m2d.role : undefined;
            L.marker([el.lat as number, el.lng as number], {
              icon: buildProposalNodeDivIcon(L, type, role),
            }).addTo(map)
              .bindPopup(`<b>${TYPE_LABELS_RU[type] || type}</b>${el.name ? `<br/>${el.name}` : ''}`)
              .bindTooltip((el.name as string) || type, { sticky: true });
          }
        }
      });
    })();

    return () => {
      cancelled = true;
      mapInitRef.current = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, proposal]);

  const handleZoom = useCallback((delta: number) => {
    if (viewMode === 'MAP_2D' && mapInstanceRef.current) {
      const next = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, mapInstanceRef.current.getZoom() + delta));
      mapInstanceRef.current.setZoom(next);
      setMapZoomDisplay(next);
    } else if (viewMode === 'GLOBE_3D' && cameraRef.current) {
      zoomLevelRef.current = applyGlobeZoomDelta({
        currentZ: zoomLevelRef.current,
        zoomDelta: delta,
        zoomStep: GLOBE_ZOOM_STEP,
        minZ: GLOBE_ZOOM_MIN,
        maxZ: GLOBE_ZOOM_MAX,
      });
      cameraRef.current.position.z = zoomLevelRef.current;
      setDisplayGlobeZoom(zoomLevelRef.current);
    }
  }, [viewMode]);

  const handleNavigate = useCallback((dir: string) => {
    if (viewMode === 'MAP_2D' && mapInstanceRef.current) {
      const step = 100;
      const offsets: Record<string, [number, number]> = {
        up: [0, -step], down: [0, step], left: [-step, 0], right: [step, 0],
        'up-left': [-step, -step], 'up-right': [step, -step],
        'down-left': [-step, step], 'down-right': [step, step],
      };
      const [dx, dy] = offsets[dir] || [0, 0];
      mapInstanceRef.current.panBy([dx, dy]);
    } else if (viewMode === 'GLOBE_3D' && globeGroupRef.current) {
      const s = 0.03;
      const rot: Record<string, [THREE.Vector3, number]> = {
        up: [new THREE.Vector3(1, 0, 0), -s],
        down: [new THREE.Vector3(1, 0, 0), s],
        left: [new THREE.Vector3(0, 1, 0), -s],
        right: [new THREE.Vector3(0, 1, 0), s],
        'up-left': [new THREE.Vector3(1, 1, 0).normalize(), -s],
        'up-right': [new THREE.Vector3(-1, 1, 0).normalize(), -s],
        'down-left': [new THREE.Vector3(1, -1, 0).normalize(), -s],
        'down-right': [new THREE.Vector3(-1, -1, 0).normalize(), -s],
      };
      const [axis, angle] = rot[dir] || [new THREE.Vector3(0, 1, 0), 0];
      globeGroupRef.current.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    }
  }, [viewMode]);

  const timeRemaining = proposal?.votingEndsAt
    ? (() => {
        const diff = new Date(proposal.votingEndsAt!).getTime() - Date.now();
        if (diff <= 0) return 'Голосование завершено';
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        return `${h}ч ${m}м осталось`;
      })()
    : null;

  const statusColor =
    proposal?.status === 'SUBMITTED'
      ? '#8ab4f8'
      : proposal?.status === 'ACCEPTED'
        ? '#3ddc97'
        : proposal?.status === 'WITHDRAWN'
          ? '#c9a227'
          : '#f6c177';

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--muted)' }}>Загрузка...</div>;
  if (error || !proposal) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: '#ff6b6b' }}>{error || 'Не найдено'}</div>;

  const nodeCount = proposalElements.filter(e => !isCableType(e.type as string)).length;
  const cableCount = proposalElements.filter(e => isCableType(e.type as string)).length;

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden', background: 'var(--bg)' }}>
      <style>{`
        .proposal-sheet-handle { display: none; }
        @media (max-width: 767px) {
          .proposal-info-panel {
            position: fixed !important;
            left: 0 !important; right: 0 !important; top: auto !important; bottom: 0 !important;
            width: 100% !important; max-height: 50vh !important;
            border-radius: 0 !important;
            border-top-left-radius: 14px !important; border-top-right-radius: 14px !important;
            padding: 12px 18px 18px !important;
            display: flex !important; flex-direction: column !important; overflow-y: auto !important;
          }
          .proposal-sheet-handle { display: block !important; width: 40px; height: 4px; margin: 0 auto 12px; border-radius: 4px; background: rgba(160,170,200,0.45); flex-shrink: 0; }
          .pv-nav-block { bottom: 12px !important; top: auto !important; right: 12px !important; left: auto !important; }
          .pv-bottom-panels { bottom: calc(52px + env(safe-area-inset-bottom, 0px)) !important; left: 8px !important; right: auto !important; }
        }
      `}</style>

      {/* 3D/2D View — слой карты ниже Leaflet-панелей; UI поверх (z-index ≥1000). */}
      {viewMode === 'GLOBE_3D' && (
        <div
          ref={threeContainerRef}
          style={{ width: '100%', height: '100%', willChange: 'transform', position: 'relative', zIndex: 0 }}
        />
      )}
      {viewMode === 'MAP_2D' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, isolation: 'isolate' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        </div>
      )}

      <div
        className="pv-bottom-panels"
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          zIndex: 1000,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 12,
        }}
      >
        <Panel title="Режим" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button onClick={() => handleToggleView('GLOBE_3D')} disabled={viewMode === 'GLOBE_3D'}>
              Глобус
            </Button>
            <Button onClick={() => handleToggleView('MAP_2D')} disabled={viewMode === 'MAP_2D'}>
              Карта
            </Button>
            <Button
              type="button"
              size="icon"
              onClick={() => handleZoom(1)}
              disabled={
                viewMode === 'MAP_2D'
                  ? mapZoomDisplay >= MAP_ZOOM_MAX - 1e-6
                  : displayGlobeZoom <= GLOBE_ZOOM_MIN + 1e-6
              }
              title="Ближе"
            >
              +
            </Button>
            <Button
              type="button"
              size="icon"
              onClick={() => handleZoom(-1)}
              disabled={
                viewMode === 'MAP_2D'
                  ? mapZoomDisplay <= MAP_ZOOM_MIN + 1e-6
                  : displayGlobeZoom >= GLOBE_ZOOM_MAX - 1e-6
              }
              title="Дальше"
            >
              −
            </Button>
            <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--muted)' }}>
              {viewMode === 'MAP_2D' ? mapZoomDisplay.toFixed(0) : displayGlobeZoom.toFixed(2)}
            </span>
          </div>
        </Panel>
        <Panel title="Данные" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Узлов: {nodeCount} · Кабелей: {cableCount}
          </div>
        </Panel>
      </div>

      {viewMode === 'GLOBE_3D' ? <ProposalCollapsibleLegend groups={legendGroups} /> : null}

      {/* Navigation arrows (2D only) — справа снизу */}
      {viewMode === 'MAP_2D' && (
        <div
          className="pv-nav-block"
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            left: 'auto',
            zIndex: 1000,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 32px)',
            gridTemplateRows: 'repeat(3, 32px)',
            gap: 2,
          }}
        >
          {(['up-left','up','up-right','left','','right','down-left','down','down-right'] as const).map((dir, i) => (
            dir === '' ? <div key={i} /> :
            <Button
              key={dir}
              type="button"
              size="icon"
              aria-label={`Навигация: ${dir}`}
              onClick={() => handleNavigate(dir)}
              style={{ borderColor: 'rgba(120,160,255,0.15)', background: 'rgba(10,20,40,0.85)', color: '#aac4ff' }}
            >
              {dir === 'up' ? '↑' : dir === 'down' ? '↓' : dir === 'left' ? '←' : dir === 'right' ? '→' :
               dir === 'up-left' ? '↖' : dir === 'up-right' ? '↗' : dir === 'down-left' ? '↙' : '↘'}
            </Button>
          ))}
        </div>
      )}

      {/* Left Panel */}
      <div
        className="proposal-info-panel"
        style={{
          position: 'absolute', right: 12, top: 64, zIndex: 1000,
          width: 320, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          background: colors.bg.card, border: `1px solid ${colors.border}`,
          borderRadius: 4, padding: '16px 16px',
          pointerEvents: 'auto',
        }}
      >
        <div className="proposal-sheet-handle" aria-hidden />
        <div style={{ position: 'relative', width: '100%', marginBottom: 10 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск поселения..."
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.bg.card,
              color: colors.text.primary,
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {searchResults.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 4,
                background: colors.bg.card,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                maxHeight: 180,
                overflowY: 'auto',
                zIndex: 2,
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              }}
            >
              {searchResults.map((r, i) => (
                <Button
                  key={i}
                  type="button"
                  size="sm"
                  onClick={() => handleSelectSearch(r)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    color: colors.text.primary,
                    fontSize: 11,
                    borderColor: 'transparent',
                    borderRadius: 0,
                  }}
                >
                  {r.display_name?.slice(0, 80) || `${r.lat}, ${r.lon}`}
                </Button>
              ))}
            </div>
          )}
          {searchLoading && (
            <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 10, color: 'var(--muted)' }}>...</span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setIsDetailsOpen(prev => !prev)}
          aria-expanded={isDetailsOpen}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 13,
            color: 'var(--text)',
            marginBottom: 8,
            borderRadius: 8,
            border: '1px solid rgba(120,160,255,0.16)',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          <span>{isDetailsOpen ? 'Скрыть детали предложения' : 'Показать детали предложения'}</span>
          <span aria-hidden>{isDetailsOpen ? '▾' : '▸'}</span>
        </Button>

        {isDetailsOpen && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: '8px 0 4px' }}>
              {proposal.title || 'Без названия'}
            </h2>

            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              {authorName || proposal.authorPubkey.slice(0, 8) + '...'}
              {' · '}
              {new Date(proposal.createdAt).toLocaleDateString('ru-RU')}
              {' · '}
              <span style={{ color: statusColor }}>{proposal.status}</span>
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Узлов: {nodeCount} · Кабелей: {cableCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              Ревизий: {proposal._count?.revisions ?? 0}
              {' · '}
              Ответвлений: {proposal._count?.forksFromThis ?? 0}
              {proposal.forkedFromProposalId ? (
                <>
                  {' · '}
                  fork от <code style={{ fontSize: 10 }}>{proposal.forkedFromProposalId.slice(0, 8)}…</code>
                </>
              ) : null}
            </div>

            <div
              style={{
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(120,160,255,0.16)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                История правок сети (песочница)
              </div>
              {revisionsLoading ? (
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>Загрузка…</p>
              ) : revisions.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>
                  Пока нет сохранённых ревизий — появятся после сохранения из песочницы.
                </p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--muted)', maxHeight: 220, overflowY: 'auto' }}>
                  {revisions.map((rev) => {
                    const ds = rev.diffSummary;
                    const summary =
                      ds && typeof ds === 'object'
                        ? `+${ds.added ?? 0} −${ds.removed ?? 0} ~${ds.changed ?? 0}`
                        : null;
                    return (
                      <li key={rev.id} style={{ marginBottom: 8 }}>
                        <div style={{ color: 'var(--text)', fontWeight: 600 }}>
                          {rev.isBaseline ? '[baseline] ' : ''}
                          {rev.message}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.85 }}>
                          {new Date(rev.createdAt).toLocaleString('ru-RU')} · {rev.authorPubkey.slice(0, 8)}…
                          {summary ? ` · ${summary}` : ''}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Vote bar */}
            {tally && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#3ddc97' }}>За: {tally.for}</span>
                  <span style={{ color: '#ff6b6b' }}>Против: {tally.against}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                  {tally.total > 0 && (
                    <div style={{ height: '100%', width: `${(tally.for / tally.total) * 100}%`, background: '#3ddc97', borderRadius: 2 }} />
                  )}
                </div>
                {timeRemaining && <div style={{ fontSize: 11, color: '#f6c177', marginTop: 4 }}>{timeRemaining}</div>}
              </div>
            )}

            {proposal.status === 'SUBMITTED' && publicKey && (!tally || tally.userVote === null) && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <Button onClick={() => handleVote('FOR')} disabled={voting || !sessionVerified}>
                  За
                </Button>
                <Button onClick={() => handleVote('AGAINST')} disabled={voting || !sessionVerified}>
                  Против
                </Button>
              </div>
            )}
            {voteError && <p style={{ fontSize: 11, color: '#ff6b6b' }}>{voteError}</p>}
            {tally?.userVote && <p style={{ fontSize: 11, color: '#3ddc97' }}>Вы проголосовали: {tally.userVote === 'FOR' ? 'За' : 'Против'}</p>}

            {pubkey && proposal.authorPubkey === pubkey && !['ACCEPTED', 'APPLIED'].includes(proposal.status) && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <ButtonLink
                    href={`/sandbox?proposalId=${encodeURIComponent(proposal.id)}`}
                    size="sm"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'var(--text)',
                      fontSize: 13,
                    }}
                  >
                    Редактировать
                  </ButtonLink>
                  {proposal.status === 'SUBMITTED' && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleWithdraw()}
                      disabled={withdrawBusy || !sessionVerified || !signMessage}
                    >
                      {withdrawBusy ? 'Снятие…' : 'Снять с голосования'}
                    </Button>
                  )}
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, marginBottom: 0 }}>
                  Полное удаление записи из базы данных — только в{' '}
                  <Link href="/cabinet" style={{ color: '#8ab4f8', textDecoration: 'none', fontWeight: 600 }}>
                    личном кабинете
                  </Link>
                  .
                </p>
              </div>
            )}
            {pubkey && proposal.authorPubkey === pubkey && !['ACCEPTED', 'APPLIED'].includes(proposal.status) && !sessionVerified && (
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                Чтобы удалить предложение, сначала нажмите «Авторизоваться» в шапке сайта.
              </p>
            )}
            {withdrawErr && <p style={{ fontSize: 11, color: '#ff6b6b', marginTop: 6 }}>{withdrawErr}</p>}
          </>
        )}
      </div>
    </div>
  );
}
