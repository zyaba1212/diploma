'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import Link from 'next/link';
import { EQUIPMENT_FACTORIES, NODE_VISUALS, CABLE_COLORS, TYPE_LABELS_RU, createSatelliteObject } from '@/lib/three/factories';
import { latLngToVec3, orientGlobeGroupCenterFromLatLng, makeTextSprite, makeTextMesh, disposeThreeObject, computeGlobeCenterLatLng } from '@/lib/three/utils';
import { WORLD_LABELS, LABEL_STYLE } from '@/lib/three/labels';
import { getEarthMaterialMode, getEarthSphereSegments } from '@/lib/earthQuality';
import { loadEarthTextures } from '@/lib/loadEarthTextures';
import { Button } from '@/components/ui/Button';
import type L from 'leaflet';

type ViewMode = 'GLOBE_3D' | 'MAP_2D';

type ProposalData = {
  id: string;
  title: string | null;
  description: string | null;
  authorPubkey: string;
  status: string;
  createdAt: string;
  votingEndsAt: string | null;
  actions: ActionData[];
};

type ActionData = {
  actionType: string;
  elementPayload: Record<string, unknown>;
};

type VoteTally = { for: number; against: number; total: number; userVote: string | null };

type SearchResult = { lat: string; lon: string; display_name?: string };

const DEG2RAD = Math.PI / 180;

function isCableType(t: string) {
  return t === 'CABLE_FIBER' || t === 'CABLE_COPPER' || t === 'CABLE_UNDERGROUND_FIBER' || t === 'CABLE_UNDERGROUND_COPPER';
}

export default function ProposalViewPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { publicKey, signMessage } = useWallet();
  const pubkey = publicKey?.toBase58() ?? '';

  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [tally, setTally] = useState<VoteTally | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('GLOBE_3D');
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationLabel, setLocationLabel] = useState('Определяем локацию…');
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);

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
  const savedCenterRef = useRef<{ lat: number; lng: number }>({ lat: 53.5, lng: 28 });

  const labelCandidatesRef = useRef<Array<{
    obj: THREE.Object3D;
    latRad: number;
    lngRad: number;
    sinLat: number;
    cosLat: number;
  }>>([]);

  // Geolocation
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationLabel('Геолокация недоступна');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLat(lat);
        setUserLng(lng);
        fetch(`/api/geocode/reverse?lat=${lat}&lon=${lng}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d) {
              const addr = d.address ?? {};
              const city = addr.city || addr.town || addr.village || addr.hamlet;
              const region = addr.state || addr.region;
              const country = addr.country;
              const parts = [city, region, country].filter(Boolean);
              setLocationLabel(parts.length ? parts.join(', ') : d.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            } else {
              setLocationLabel(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            }
          })
          .catch(() => setLocationLabel(`${lat.toFixed(4)}, ${lng.toFixed(4)}`));
      },
      () => setLocationLabel('Геолокация недоступна (требуется HTTPS или разрешение браузера)'),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, []);

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
    if (!publicKey || !signMessage || !id) return;
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
  }, [publicKey, signMessage, id, pubkey]);

  const proposalElements = proposal?.actions
    .filter(a => a.actionType === 'CREATE' && a.elementPayload)
    .map(a => a.elementPayload) ?? [];

  const getGlobeCenterLatLng = useCallback((): { lat: number; lng: number } => {
    if (globeGroupRef.current) {
      return computeGlobeCenterLatLng(globeGroupRef.current) ?? { lat: 53.5, lng: 28 };
    }
    return { lat: 53.5, lng: 28 };
  }, []);

  const handleToggleView = useCallback((target: ViewMode) => {
    if (target === viewMode) return;
    if (target === 'MAP_2D') {
      savedCenterRef.current = getGlobeCenterLatLng();
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a18);

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    camera.position.set(0, 0, zoomLevelRef.current);
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
      let earthMat: THREE.Material;
      if (materialMode === 'standard') {
        earthMat = new THREE.MeshStandardMaterial({
          map: set.color, normalMap: set.normal, normalScale: new THREE.Vector2(0.055, 0.055),
          roughness: 0.62, metalness: 0.06, emissive: new THREE.Color(0x0b2d55), emissiveIntensity: 0.42,
        });
      } else {
        earthMat = new THREE.MeshPhongMaterial({
          map: set.color, normalMap: set.normal, normalScale: new THREE.Vector2(0.04, 0.04),
          shininess: 15, specular: new THREE.Color(0x2f3b62), emissive: new THREE.Color(0x0e3a6a), emissiveIntensity: 0.35,
        });
      }
      (globeGroup.children[0] as THREE.Mesh).material = earthMat;
      if (set.clouds) {
        (globeGroup.children[1] as THREE.Mesh).material = new THREE.MeshPhongMaterial({ map: set.clouds, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
      }
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
        const colorHex = parseInt((CABLE_COLORS[type] || '#ff9900').replace('#', ''), 16);
        const isDashed = type.includes('UNDERGROUND');
        const mat = isDashed
          ? new THREE.LineDashedMaterial({ color: colorHex, transparent: true, opacity: 0.85, dashSize: 0.04, gapSize: 0.03, clippingPlanes: [clipPlane] })
          : new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, clippingPlanes: [clipPlane] });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, mat);
        if (isDashed) line.computeLineDistances();
        line.frustumCulled = false;
        line.userData = { elName: el.name, elType: type };
        networkGroup.add(line);
      } else if (typeof el.lat === 'number' && typeof el.lng === 'number') {
        const visual = NODE_VISUALS[type];
        if (!visual) continue;

        let altitudeKm = 0;
        if (typeof el.altitude === 'number' && Number.isFinite(el.altitude as number)) altitudeKm = el.altitude as number;
        else if (type === 'SATELLITE') altitudeKm = 550;
        const nodeR = type === 'SATELLITE' ? 1.0 + altitudeKm / 6371 : 1.012 + (visual.size - 0.01) * 0.9;

        const pos = latLngToVec3(el.lat as number, el.lng as number, nodeR);
        if (!pos) continue;
        const normal = pos.clone().normalize();

        let marker: THREE.Object3D;
        if (type === 'SATELLITE') {
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

        const labelText = (el.name as string)?.trim() || TYPE_LABELS_RU[type] || type;
        const sprite = makeTextSprite(labelText, { background: 'rgba(0,0,0,0.55)', color: '#eaf2ff', fontSize: 18 });
        sprite.position.copy(pos);
        sprite.position.add(normal.clone().multiplyScalar(0.03 + visual.size * 0.4));
        sprite.visible = false;
        networkGroup.add(sprite);

        const latRad = (el.lat as number) * DEG2RAD;
        const lngRad = (el.lng as number) * DEG2RAD;
        labelCandidatesRef.current.push({ obj: sprite, latRad, lngRad, sinLat: Math.sin(latRad), cosLat: Math.cos(latRad) });
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
      labelCandidatesRef.current.push({ obj: mesh, latRad, lngRad, sinLat: Math.sin(latRad), cosLat: Math.cos(latRad) });
    }

    // Satellites (Starlink etc.)
    const satelliteCount = 60;
    for (let i = 0; i < satelliteCount; i++) {
      const lat = (Math.random() - 0.5) * 140;
      const lng = Math.random() * 360 - 180;
      const alt = 540 + Math.random() * 20;
      const visual = NODE_VISUALS['SATELLITE'];
      if (!visual) continue;
      const r = 1.0 + alt / 6371;
      const pos = latLngToVec3(lat, lng, r);
      if (!pos) continue;
      const normal = pos.clone().normalize();
      const sat = createSatelliteObject(visual.size * 0.6, visual.color, visual.emissive);
      sat.position.copy(pos);
      sat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      sat.userData = { elName: `Starlink-${i + 1}`, elType: 'SATELLITE' };
      networkGroup.add(sat);
    }

    let dragging = false, prevX = 0, prevY = 0;
    const onPointerDown = (e: PointerEvent) => { if (e.pointerType === 'touch') return; dragging = true; prevX = e.clientX; prevY = e.clientY; };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerType === 'touch') return;
      const dx = e.clientX - prevX, dy = e.clientY - prevY;
      prevX = e.clientX; prevY = e.clientY;
      globeGroup.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.005));
      globeGroup.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.005));
    };
    const onPointerUp = (e: PointerEvent) => { if (e.pointerType === 'touch') return; dragging = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomLevelRef.current = Math.max(1.2, Math.min(6, zoomLevelRef.current + (e.deltaY > 0 ? 0.15 : -0.15)));
      camera.position.z = zoomLevelRef.current;
    };

    // Touch controls
    let touchStartDist = 0;
    let touchPrevX = 0, touchPrevY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchPrevX = e.touches[0].clientX;
        touchPrevY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchPrevX;
        const dy = e.touches[0].clientY - touchPrevY;
        touchPrevX = e.touches[0].clientX;
        touchPrevY = e.touches[0].clientY;
        globeGroup.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.005));
        globeGroup.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.005));
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const delta = (touchStartDist - dist) * 0.01;
        zoomLevelRef.current = Math.max(1.2, Math.min(6, zoomLevelRef.current + delta));
        camera.position.z = zoomLevelRef.current;
        touchStartDist = dist;
      }
    };

    // Tooltip
    const tooltipDiv = document.createElement('div');
    tooltipDiv.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none;background:rgba(10,20,45,0.95);border:1px solid rgba(120,160,255,0.3);border-radius:8px;padding:6px 12px;font-size:12px;color:#eaf2ff;max-width:240px;backdrop-filter:blur(6px)';
    document.body.appendChild(tooltipDiv);
    const raycaster = new THREE.Raycaster();
    const onMouseMove = (e: MouseEvent) => {
      const rect = mount.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(networkGroup.children, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && !obj.userData?.elType && obj.parent && obj.parent !== networkGroup) obj = obj.parent;
        if (obj?.userData?.elType) {
          const t = obj.userData.elType as string;
          const label = TYPE_LABELS_RU[t] || t;
          const name = obj.userData.elName || '';
          tooltipDiv.innerHTML = `<b>${label}</b>${name ? `<br/>${name}` : ''}`;
          tooltipDiv.style.display = 'block';
          tooltipDiv.style.left = `${e.clientX + 12}px`;
          tooltipDiv.style.top = `${e.clientY + 12}px`;
          return;
        }
      }
      tooltipDiv.style.display = 'none';
    };

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('wheel', onWheel, { passive: false });
    mount.addEventListener('touchstart', onTouchStart, { passive: true });
    mount.addEventListener('touchmove', onTouchMove, { passive: false });
    mount.addEventListener('mousemove', onMouseMove);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      // Update label visibility based on globe center
      const center = computeGlobeCenterLatLng(globeGroup) ?? { lat: 53.5, lng: 28 };
      const cLat = center.lat * DEG2RAD;
      const cLng = center.lng * DEG2RAD;
      const sinCLat = Math.sin(cLat);
      const cosCLat = Math.cos(cLat);
      const zLvl = camera.position.z;
      const threshold = zLvl < 1.8 ? 0.4 : zLvl < 2.5 ? 0.55 : 0.85;

      for (const lc of labelCandidatesRef.current) {
        const dLng = lc.lngRad - cLng;
        const cosD = sinCLat * lc.sinLat + cosCLat * lc.cosLat * Math.cos(dLng);
        lc.obj.visible = cosD > threshold;
      }

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => { camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight); };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('wheel', onWheel);
      mount.removeEventListener('touchstart', onTouchStart);
      mount.removeEventListener('touchmove', onTouchMove);
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
      const map = L.map(mapContainerRef.current, { center: [initCenter.lat, initCenter.lng], zoom: 6, zoomControl: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM', maxZoom: 18 }).addTo(map);
      mapInstanceRef.current = map;

      map.whenReady(() => {
        map.invalidateSize();

        if (userLat !== null && userLng !== null) {
          L.circleMarker([userLat, userLng], {
            radius: 8, color: '#4285f4', fillColor: '#4285f4', fillOpacity: 0.8, weight: 2,
          }).addTo(map).bindPopup('Ваше местоположение');
        }

        for (const el of proposalElements) {
          const type = el.type as string;
          if (isCableType(type) && Array.isArray(el.path)) {
            const pts = (el.path as Array<{ lat: number; lng: number }>).map(p => [p.lat, p.lng] as [number, number]);
            if (pts.length < 2) continue;
            const color = CABLE_COLORS[type] || '#ff9900';
            const isDashed = type.includes('UNDERGROUND');
            L.polyline(pts, { color, weight: 3, dashArray: isDashed ? '8,6' : undefined })
              .addTo(map)
              .bindPopup(`<b>${TYPE_LABELS_RU[type] || type}</b>${el.name ? `<br/>${el.name}` : ''}`)
              .bindTooltip(el.type as string, { sticky: true });
          } else if (typeof el.lat === 'number' && typeof el.lng === 'number') {
            const v = NODE_VISUALS[type];
            const c = v ? '#' + v.color.toString(16).padStart(6, '0') : '#ff9900';
            if (type === 'SATELLITE') {
              L.circleMarker([el.lat as number, el.lng as number], {
                radius: 5, color: c, fillColor: c, fillOpacity: 0.7, weight: 1,
              }).addTo(map)
                .bindPopup(`<b>${TYPE_LABELS_RU[type] || type}</b>${el.name ? `<br/>${el.name}` : ''}`)
                .bindTooltip((el.name as string) || type, { sticky: true });
            } else {
              L.marker([el.lat as number, el.lng as number], {
                icon: L.divIcon({
                  className: '',
                  html: `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 0 6px ${c}"></div>`,
                  iconSize: [14, 14],
                  iconAnchor: [7, 7],
                }),
              }).addTo(map)
                .bindPopup(`<b>${TYPE_LABELS_RU[type] || type}</b>${el.name ? `<br/>${el.name}` : ''}`)
                .bindTooltip((el.name as string) || type, { sticky: true });
            }
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
      mapInstanceRef.current.setZoom(mapInstanceRef.current.getZoom() + delta);
    } else if (viewMode === 'GLOBE_3D' && cameraRef.current) {
      zoomLevelRef.current = Math.max(1.2, Math.min(6, zoomLevelRef.current - delta * 0.5));
      cameraRef.current.position.z = zoomLevelRef.current;
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

  const handleGoToLocation = useCallback(() => {
    if (userLat === null || userLng === null) return;
    if (viewMode === 'MAP_2D' && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([userLat, userLng], 12);
    } else if (viewMode === 'GLOBE_3D' && globeGroupRef.current) {
      orientGlobeGroupCenterFromLatLng(globeGroupRef.current, userLat, userLng);
    }
  }, [viewMode, userLat, userLng]);

  const timeRemaining = proposal?.votingEndsAt
    ? (() => {
        const diff = new Date(proposal.votingEndsAt!).getTime() - Date.now();
        if (diff <= 0) return 'Голосование завершено';
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        return `${h}ч ${m}м осталось`;
      })()
    : null;

  const statusColor = proposal?.status === 'SUBMITTED' ? '#8ab4f8' : proposal?.status === 'ACCEPTED' ? '#3ddc97' : '#f6c177';

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
          .pv-nav-block { bottom: auto !important; top: 70px !important; right: 12px !important; left: auto !important; }
          .pv-search-block { right: 12px !important; left: auto !important; top: 12px !important; width: 200px !important; }
        }
      `}</style>

      {/* 3D/2D View */}
      {viewMode === 'GLOBE_3D' && <div ref={threeContainerRef} style={{ width: '100%', height: '100%', willChange: 'transform' }} />}
      {viewMode === 'MAP_2D' && <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />}

      {/* Location badge (2D only) */}
      {viewMode === 'MAP_2D' && (
        <div style={{
          position: 'absolute', top: 62, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          background: 'rgba(10,20,40,0.9)', border: '1px solid rgba(120,160,255,0.2)', borderRadius: 10,
          padding: '4px 14px', fontSize: 12, color: 'var(--muted)', pointerEvents: 'auto', cursor: userLat !== null ? 'pointer' : 'default',
          whiteSpace: 'nowrap',
        }} onClick={handleGoToLocation}>
          📍 {locationLabel}
        </div>
      )}

      {/* Search */}
      <div className="pv-search-block" style={{ position: 'absolute', top: 62, right: 340, zIndex: 30, width: 260 }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Поиск поселения..."
          style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(120,160,255,0.2)', background: 'rgba(10,20,40,0.9)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
        />
        {searchResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'rgba(18,22,40,0.98)', border: '1px solid rgba(120,160,255,0.2)', borderRadius: 8, maxHeight: 180, overflowY: 'auto', zIndex: 100 }}>
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

      {/* Zoom controls */}
      <div style={{ position: 'absolute', bottom: 20, left: 12, zIndex: 30, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button onClick={() => handleZoom(1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(120,160,255,0.2)', background: 'rgba(10,20,40,0.9)', color: '#fff', fontSize: 18, cursor: 'pointer' }}>+</button>
        <button onClick={() => handleZoom(-1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(120,160,255,0.2)', background: 'rgba(10,20,40,0.9)', color: '#fff', fontSize: 18, cursor: 'pointer' }}>&minus;</button>
      </div>

      {/* Navigation arrows (2D only) */}
      {viewMode === 'MAP_2D' && (
        <div className="pv-nav-block" style={{ position: 'absolute', bottom: 20, left: 56, zIndex: 30, display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gridTemplateRows: 'repeat(3, 32px)', gap: 2 }}>
          {(['up-left','up','up-right','left','','right','down-left','down','down-right'] as const).map((dir, i) => (
            dir === '' ? <div key={i} /> :
            <button key={dir} onClick={() => handleNavigate(dir)} style={{
              width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(120,160,255,0.15)',
              background: 'rgba(10,20,40,0.85)', color: '#aac4ff', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {dir === 'up' ? '↑' : dir === 'down' ? '↓' : dir === 'left' ? '←' : dir === 'right' ? '→' :
               dir === 'up-left' ? '↖' : dir === 'up-right' ? '↗' : dir === 'down-left' ? '↙' : '↘'}
            </button>
          ))}
        </div>
      )}

      {/* Left Panel */}
      <div
        className="proposal-info-panel"
        style={{
          position: 'absolute', right: 12, top: 64, zIndex: 20,
          width: 320, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
          background: 'rgba(10,20,40,0.92)', border: '1px solid rgba(120,160,255,0.2)',
          borderRadius: 14, padding: '18px 20px', backdropFilter: 'blur(8px)',
          pointerEvents: 'auto',
        }}
      >
        <div className="proposal-sheet-handle" aria-hidden />
        <Link href="/networks" style={{ fontSize: 12, color: '#8ab4f8', textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
          &larr; Все предложения
        </Link>

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

        {proposal.description && (
          <p style={{ fontSize: 13, color: 'rgba(200,220,255,0.8)', lineHeight: 1.5, marginBottom: 10 }}>
            {proposal.description}
          </p>
        )}

        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Узлов: {nodeCount} · Кабелей: {cableCount}
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
            <Button onClick={() => handleVote('FOR')} disabled={voting}>За</Button>
            <Button onClick={() => handleVote('AGAINST')} disabled={voting}>Против</Button>
          </div>
        )}
        {voteError && <p style={{ fontSize: 11, color: '#ff6b6b' }}>{voteError}</p>}
        {tally?.userVote && <p style={{ fontSize: 11, color: '#3ddc97' }}>Вы проголосовали: {tally.userVote === 'FOR' ? 'За' : 'Против'}</p>}

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          <Button onClick={() => handleToggleView('GLOBE_3D')} disabled={viewMode === 'GLOBE_3D'}>3D Глобус</Button>
          <Button onClick={() => handleToggleView('MAP_2D')} disabled={viewMode === 'MAP_2D'}>2D Карта</Button>
        </div>

        {/* Element list */}
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(120,160,255,0.12)', paddingTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Элементы:</div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {proposalElements.slice(0, 50).map((el, i) => {
              const type = el.type as string;
              const isCbl = isCableType(type);
              const c = isCbl ? (CABLE_COLORS[type] || '#ccc') : (NODE_VISUALS[type] ? '#' + NODE_VISUALS[type].color.toString(16).padStart(6, '0') : '#ccc');
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', fontSize: 11, color: 'var(--muted)' }}>
                  <span style={{ width: isCbl ? 12 : 8, height: isCbl ? 4 : 8, borderRadius: isCbl ? 1 : '50%', background: c, flexShrink: 0 }} />
                  {TYPE_LABELS_RU[type] || type}: {(el.name as string) || '—'}
                </div>
              );
            })}
            {proposalElements.length > 50 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>+{proposalElements.length - 50} ещё</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
