'use client';
// MapView — компонент интерфейса (React).


import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { normalizeLatLng } from '@/lib/geo/normalizeLatLng';
import { padBounds, type LatLngBounds } from '@/lib/geo/networkBounds';
import { SATELLITE_MIN_VISIBLE_ZOOM, type BboxTuple } from '@/lib/geo/viewportBbox';
import type { LatLng, NetworkElementDTO, NetworkResponseDTO } from '@/lib/types';
import {
  cableSourceLinks,
} from '@/lib/cableSourceLinks';
import { buildProposalNodeDivIcon } from '@/lib/leaflet/proposalNodeIcons';
import { CABLE_COLORS } from '@/lib/three/factories';
import type L from 'leaflet';
import type { LayerGroup } from 'leaflet';

/** Канонический цвет линии "satellite" совпадает с networks/[id] и легендой. */
const SATELLITE_LINK_COLOR = '#8ab4f8';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
}

/** Сигнатура слоя для инкрементального обновления без полного clearLayers. */
function mapElementOverlaySig(
  el: NetworkElementDTO,
  leafletZoom: number,
  providersFp: string,
): string | null {
  const meta = el.metadata as Record<string, unknown> | undefined;
  const linkKindRaw = meta?.linkKind;
  const isSatelliteLink = typeof linkKindRaw === 'string' && linkKindRaw === 'satellite';

  const isCableType =
    el.type === 'CABLE_FIBER' ||
    el.type === 'CABLE_COPPER' ||
    el.type === 'CABLE_UNDERGROUND_FIBER' ||
    el.type === 'CABLE_UNDERGROUND_COPPER';

  if (el.path && isCableType) {
    const path = el.path;
    if (path.length >= 2) {
      const a = path[0];
      const b = path[path.length - 1];
      const pathKey = `${path.length}:${a.lat.toFixed(5)}:${a.lng.toFixed(5)}:${b.lat.toFixed(5)}:${b.lng.toFixed(5)}`;
      return `cable:${el.id}:${el.type}:${isSatelliteLink ? 'sat' : 'nosat'}:${pathKey}:${providersFp}`;
    }
    // короткий path — как в legacy MapView: ниже пробуем узел по lat/lng
  }

  if (typeof el.lat === 'number' && typeof el.lng === 'number') {
    const satHidden =
      (el.type === 'SATELLITE' || el.type === 'SATELLITE_RASSVET') &&
      leafletZoom < SATELLITE_MIN_VISIBLE_ZOOM;
    if (satHidden) return 'hidden_sat_node';
    return `node:${el.id}:${el.type}:${el.lat.toFixed(6)}:${el.lng.toFixed(6)}:${leafletZoom}:${providersFp}`;
  }

  return null;
}

function renderCableOverlayGroup(
  L: typeof import('leaflet'),
  el: NetworkElementDTO,
  providerNameById: Map<string, string>,
  providerSourceUrlById: Map<string, string>,
): LayerGroup | null {
  if (
    !el.path ||
    !(
      el.type === 'CABLE_FIBER' ||
      el.type === 'CABLE_COPPER' ||
      el.type === 'CABLE_UNDERGROUND_FIBER' ||
      el.type === 'CABLE_UNDERGROUND_COPPER'
    )
  ) {
    return null;
  }

  const latlngs = el.path
    .map((p) => [p.lat, p.lng] as [number, number])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (latlngs.length < 2) return null;

  const isUnderground =
    el.type === 'CABLE_UNDERGROUND_FIBER' || el.type === 'CABLE_UNDERGROUND_COPPER';

  const linkKindRaw = (el.metadata as Record<string, unknown> | undefined)?.linkKind;
  const isSatelliteLink = typeof linkKindRaw === 'string' && linkKindRaw === 'satellite';
  const color = isSatelliteLink ? SATELLITE_LINK_COLOR : (CABLE_COLORS[el.type] ?? '#ff9900');
  const isDashed = isSatelliteLink || isUnderground;
  const dashTop = isSatelliteLink ? '2,6' : (isUnderground ? '8,6' : undefined);
  const dashShadow = isSatelliteLink ? '3,7' : (isUnderground ? '9,7' : undefined);

  const provider = el.providerId ? (providerNameById.get(el.providerId) ?? '') : '';
  const countries = el.metadata?.countries
    ? Array.isArray(el.metadata.countries)
      ? (el.metadata.countries as string[]).join(', ')
      : String(el.metadata.countries)
    : '';
  const year =
    el.metadata?.year != null && el.metadata?.year !== ''
      ? String(el.metadata.year as string | number)
      : '';

  const links = cableSourceLinks({
    elType: el.type,
    cableName: typeof el.name === 'string' ? el.name : '',
    metadata: el.metadata,
    elementSourceUrl: el.sourceUrl,
    providerSourceUrl: el.providerId ? (providerSourceUrlById.get(el.providerId) ?? '') : '',
  });
  let sourcesHtml = '';
  if (links.length > 0) {
    sourcesHtml = '<br/><span style="color:#8ab4f8">Источники</span>';
    for (const link of links) {
      sourcesHtml += `<br/><a href="${escapeHtmlAttr(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`;
      if (link.domain) {
        sourcesHtml += ` <span style="color:rgba(180,210,255,0.72);font-size:11px">(${escapeHtml(link.domain)})</span>`;
      }
      if (link.note) {
        sourcesHtml += `<br/><span style="color:rgba(180,210,255,0.7);font-size:11px">${escapeHtml(link.note)}</span>`;
      }
    }
  }

  const g = L.layerGroup();

  L.polyline(latlngs, {
    color: '#071120',
    weight: 6,
    opacity: 0.24,
    dashArray: dashShadow,
  }).addTo(g);

  L.polyline(latlngs, {
    color,
    weight: 3,
    opacity: 0.92,
    dashArray: dashTop,
  })
    .bindTooltip(
      `<b>${escapeHtml(String(el.name || el.type))}</b>` +
        (provider ? `<br/>Провайдер: ${escapeHtml(provider)}` : '') +
        (year ? `<br/>Год: ${escapeHtml(year)}` : '') +
        (countries ? `<br/>Страны: ${escapeHtml(countries)}` : '') +
        sourcesHtml,
      { sticky: true, className: 'map-tooltip' },
    )
    .addTo(g);

  return g;
}

function renderNodeOverlayGroup(
  L: typeof import('leaflet'),
  el: NetworkElementDTO,
  providerNameById: Map<string, string>,
  providerSourceUrlById: Map<string, string>,
): LayerGroup | null {
  if (typeof el.lat !== 'number' || typeof el.lng !== 'number') return null;

  const nodeProvider = el.providerId ? (providerNameById.get(el.providerId) ?? '') : '';
  const nodeProviderSourceUrl = el.providerId ? (providerSourceUrlById.get(el.providerId) ?? '') : '';
  const nodeCountries = el.metadata?.countries
    ? Array.isArray(el.metadata.countries)
      ? (el.metadata.countries as string[]).join(', ')
      : String(el.metadata.countries)
    : '';
  const nodeLinks = cableSourceLinks({
    elType: el.type,
    cableName: typeof el.name === 'string' ? el.name : '',
    metadata: el.metadata,
    elementSourceUrl: el.sourceUrl,
    providerSourceUrl: nodeProviderSourceUrl,
  });
  let nodeSourcesHtml = '';
  if (nodeLinks.length > 0) {
    nodeSourcesHtml = '<br/><span style="color:#8ab4f8">Источники</span>';
    for (const link of nodeLinks) {
      nodeSourcesHtml += `<br/><a href="${escapeHtmlAttr(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`;
      if (link.domain) {
        nodeSourcesHtml += ` <span style="color:rgba(180,210,255,0.72);font-size:11px">(${escapeHtml(link.domain)})</span>`;
      }
      if (link.note) {
        nodeSourcesHtml += `<br/><span style="color:rgba(180,210,255,0.7);font-size:11px">${escapeHtml(link.note)}</span>`;
      }
    }
  }

  const roleRaw = el.metadata?.role;
  const role = typeof roleRaw === 'string' ? roleRaw : undefined;
  const g = L.layerGroup();
  L.marker([el.lat, el.lng], {
    icon: buildProposalNodeDivIcon(L, el.type, role),
  })
    .bindTooltip(
      `<b>${escapeHtml(String(el.name || el.type))}</b>` +
        (nodeProvider ? `<br/>Провайдер: ${escapeHtml(nodeProvider)}` : '') +
        (nodeCountries ? `<br/>${escapeHtml(nodeCountries)}` : '') +
        nodeSourcesHtml,
      { sticky: true, className: 'map-tooltip' },
    )
    .addTo(g);

  return g;
}

export function MapView({
  network,
  center,
  initialCenter,
  autoFitBounds,
  onCenterChanged,
  onMapReady,
  onMapUnmount,
  onZoomChanged,
  /** Видимая область карты — для загрузки сети по bbox (глобальная сеть). */
  onViewportChange,
  onError,
  /** Текущий зум карты (синхронизировать с Leaflet); ниже `SATELLITE_MIN_VISIBLE_ZOOM` узлы SATELLITE не рисуются. */
  mapZoom,
}: {
  network: NetworkResponseDTO | null;
  center?: LatLng | null;
  initialCenter?: LatLng | null;
  /** When set, map fits this box once per value (e.g. regional OSM + Gold Coast data). */
  autoFitBounds?: LatLngBounds | null;
  onCenterChanged?: (center: LatLng) => void;
  onMapReady?: (map: L.Map) => void;
  onMapUnmount?: (center: LatLng) => void;
  onZoomChanged?: (zoom: number) => void;
  onViewportChange?: (payload: { bbox: BboxTuple; zoom: number }) => void;
  onError?: (msg: string) => void;
  mapZoom?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const onCenterChangedRef = useRef<typeof onCenterChanged>(onCenterChanged);
  const onMapReadyRef = useRef<typeof onMapReady>(onMapReady);
  const onMapUnmountRef = useRef<typeof onMapUnmount>(onMapUnmount);
  const onZoomChangedRef = useRef<typeof onZoomChanged>(onZoomChanged);
  const onViewportChangeRef = useRef<typeof onViewportChange>(onViewportChange);
  const lastSetCenterRef = useRef<LatLng | null>(null);
  const initialCenterRef = useRef<LatLng | null | undefined>(initialCenter);
  const pendingCenterRef = useRef<LatLng | null>(null);
  const onErrorRef = useRef<typeof onError>(onError);
  const lastAutoFitKeyRef = useRef<string | null>(null);
  /** Leaflet и layer group создаются асинхронно; без этого сеть могла прийти раньше карты и эффект не повторялся. */
  const [mapReady, setMapReady] = useState(false);
  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of network?.providers ?? []) map.set(p.id, p.name);
    return map;
  }, [network?.providers]);
  const providerSourceUrlById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of network?.providers ?? []) map.set(p.id, p.sourceUrl ?? '');
    return map;
  }, [network?.providers]);

  const overlayByIdRef = useRef<Map<string, LayerGroup>>(new Map());
  const overlaySigRef = useRef<Map<string, string>>(new Map());
  const providersFingerprint = useMemo(() => {
    const ps = network?.providers;
    if (!ps?.length) return '';
    return ps.map((p) => `${p.id}:${p.name}:${p.sourceUrl ?? ''}`).sort().join('|');
  }, [network?.providers]);

  useEffect(() => {
    initialCenterRef.current = initialCenter;
  }, [initialCenter]);

  useEffect(() => {
    onCenterChangedRef.current = onCenterChanged;
  }, [onCenterChanged]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  useEffect(() => {
    onMapUnmountRef.current = onMapUnmount;
  }, [onMapUnmount]);

  useEffect(() => {
    onZoomChangedRef.current = onZoomChanged;
  }, [onZoomChanged]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  /** Раньше onMapUnmount в cleanup useEffect — после layout родителя; вызываем центр до перехода EarthScene. */
  useLayoutEffect(() => {
    return () => {
      const m = mapRef.current;
      if (m) {
        const gc = m.getCenter();
        onMapUnmountRef.current?.(normalizeLatLng(gc.lat, gc.lng));
      }
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const overlayIdMap = overlayByIdRef.current;
    const overlaySigMap = overlaySigRef.current;
    let cancelled = false;

    void (async () => {
      let L: typeof import('leaflet');
      try {
        L = await import('leaflet');
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          L = await import('leaflet');
        } catch (e2) {
          onErrorRef.current?.(e2 instanceof Error ? e2.message : 'Failed to load map library');
          return;
        }
      }
      if (cancelled) return;
      leafletRef.current = L;

      if (mapRef.current) {
        const prev = mapRef.current;
        mapRef.current = null;
        setTimeout(() => prev.remove(), 400);
      }

      const map = L.map(el, {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        minZoom: 2,
        maxZoom: 19,
        scrollWheelZoom: true,
      }).setView(
        initialCenterRef.current
          ? [initialCenterRef.current.lat, initialCenterRef.current.lng]
          : [0, 0],
        initialCenterRef.current ? 4 : 2,
      );
      mapRef.current = map;
      onMapReadyRef.current?.(map);

      if (pendingCenterRef.current) {
        map.setView([pendingCenterRef.current.lat, pendingCenterRef.current.lng], map.getZoom());
        pendingCenterRef.current = null;
      }

      L.tileLayer('/api/tile?z={z}&x={x}&y={y}&source=osm', {
        maxZoom: 19,
        attribution: '',
      }).addTo(map);

      const group = L.layerGroup();
      group.addTo(map);
      layerRef.current = group;

      const emitViewport = () => {
        const b = map.getBounds();
        const bbox: BboxTuple = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
        onViewportChangeRef.current?.({ bbox, zoom: map.getZoom() });
      };

      const onMoveEnd = () => {
        const c = map.getCenter();
        onCenterChangedRef.current?.({ lat: c.lat, lng: c.lng });
        emitViewport();
      };
      const onZoomEnd = () => {
        onZoomChangedRef.current?.(map.getZoom());
        emitViewport();
      };
      map.on('moveend', onMoveEnd);
      map.on('zoomend', onZoomEnd);
      onMoveEnd();
      onZoomEnd();

      const invalidate = () => {
        map.invalidateSize({ animate: false });
      };
      invalidate();
      requestAnimationFrame(() => {
        invalidate();
        requestAnimationFrame(invalidate);
      });

      if (!cancelled) setMapReady(true);
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      overlayIdMap.clear();
      overlaySigMap.clear();
      const m = mapRef.current;
      leafletRef.current = null;
      layerRef.current = null;
      mapRef.current = null;
      if (m) setTimeout(() => m.remove(), 400);
    };
  }, []);

  /** Leaflet: пересчёт размера после layout и при resize контейнера (иначе «кусок» карты / серые полосы). */
  useEffect(() => {
    if (!mapReady) return;
    const el = ref.current;
    const map = mapRef.current;
    if (!el || !map) return;

    let debounceT: ReturnType<typeof setTimeout> | undefined;
    const scheduleInvalidate = () => {
      if (debounceT !== undefined) clearTimeout(debounceT);
      debounceT = setTimeout(() => {
        debounceT = undefined;
        map.invalidateSize({ animate: false });
      }, 80);
    };

    scheduleInvalidate();

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => scheduleInvalidate());
      ro.observe(el);
    }

    window.addEventListener('resize', scheduleInvalidate);

    return () => {
      if (debounceT !== undefined) clearTimeout(debounceT);
      ro?.disconnect();
      window.removeEventListener('resize', scheduleInvalidate);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!center) return;
    const map = mapRef.current;
    if (!map) {
      pendingCenterRef.current = center;
      return;
    }
    if (
      lastSetCenterRef.current &&
      Math.abs(lastSetCenterRef.current.lat - center.lat) < 1e-9 &&
      Math.abs(lastSetCenterRef.current.lng - center.lng) < 1e-9
    ) {
      return;
    }
    lastSetCenterRef.current = center;
    map.setView([center.lat, center.lng], map.getZoom());
    requestAnimationFrame(() => map.invalidateSize({ animate: false }));
  }, [center]);

  useEffect(() => {
    if (!autoFitBounds) {
      lastAutoFitKeyRef.current = null;
    }
  }, [autoFitBounds]);

  useEffect(() => {
    if (!mapReady || !autoFitBounds) return;
    const map = mapRef.current;
    const Lmod = leafletRef.current;
    if (!map || !Lmod) return;

    const padded = padBounds(autoFitBounds);
    const key = `${padded.minLat.toFixed(5)}:${padded.minLng.toFixed(5)}:${padded.maxLat.toFixed(5)}:${padded.maxLng.toFixed(5)}`;
    if (lastAutoFitKeyRef.current === key) return;
    lastAutoFitKeyRef.current = key;

    const sw = Lmod.latLng(padded.minLat, padded.minLng);
    const ne = Lmod.latLng(padded.maxLat, padded.maxLng);
    const bounds = Lmod.latLngBounds(sw, ne);
    if (!bounds.isValid()) return;

    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16, animate: false });
    requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    const c = map.getCenter();
    onCenterChangedRef.current?.(normalizeLatLng(c.lat, c.lng));
  }, [mapReady, autoFitBounds]);

  useEffect(() => {
    if (!mapReady) return;
    const L = leafletRef.current;
    const group = layerRef.current;
    const map = mapRef.current;
    if (!L || !group || !map) return;

    const leafletZoom = typeof mapZoom === 'number' ? mapZoom : map.getZoom();

    const removeOverlay = (id: string) => {
      const sub = overlayByIdRef.current.get(id);
      if (sub) {
        group.removeLayer(sub);
        overlayByIdRef.current.delete(id);
      }
      overlaySigRef.current.delete(id);
    };

    if (!network) {
      for (const id of [...overlayByIdRef.current.keys()]) {
        removeOverlay(id);
      }
      return;
    }

    const keep = new Set<string>();

    for (const el of network.elements) {
      const sig = mapElementOverlaySig(el, leafletZoom, providersFingerprint);
      if (sig === null) {
        removeOverlay(el.id);
        continue;
      }
      if (sig === 'hidden_sat_node') {
        removeOverlay(el.id);
        continue;
      }
      if (overlaySigRef.current.get(el.id) === sig) {
        keep.add(el.id);
        continue;
      }

      removeOverlay(el.id);

      const isCable =
        el.path &&
        (el.type === 'CABLE_FIBER' ||
          el.type === 'CABLE_COPPER' ||
          el.type === 'CABLE_UNDERGROUND_FIBER' ||
          el.type === 'CABLE_UNDERGROUND_COPPER');
      const latlngsOk =
        isCable &&
        el.path!.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).length >= 2;
      const sub = latlngsOk
        ? renderCableOverlayGroup(L, el, providerNameById, providerSourceUrlById)
        : renderNodeOverlayGroup(L, el, providerNameById, providerSourceUrlById);

      if (!sub) continue;

      sub.addTo(group);
      overlayByIdRef.current.set(el.id, sub);
      overlaySigRef.current.set(el.id, sig);
      keep.add(el.id);
    }

    for (const id of [...overlayByIdRef.current.keys()]) {
      if (!keep.has(id)) removeOverlay(id);
    }
  }, [network, mapReady, mapZoom, providerNameById, providerSourceUrlById, providersFingerprint]);

  return <div ref={ref} style={{ height: '100%', width: '100%' }} />;
}

