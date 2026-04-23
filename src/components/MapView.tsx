'use client';
// MapView — компонент интерфейса (React).


import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { normalizeLatLng } from '@/lib/geo/normalizeLatLng';
import { padBounds, type LatLngBounds } from '@/lib/geo/networkBounds';
import { SATELLITE_MIN_VISIBLE_ZOOM, type BboxTuple } from '@/lib/geo/viewportBbox';
import type { LatLng, NetworkResponseDTO } from '@/lib/types';
import {
  cableSourceLinks,
} from '@/lib/cableSourceLinks';
import type L from 'leaflet';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
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

      if (!cancelled) setMapReady(true);
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      const m = mapRef.current;
      leafletRef.current = null;
      layerRef.current = null;
      mapRef.current = null;
      if (m) setTimeout(() => m.remove(), 400);
    };
  }, []);

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

    group.clearLayers();

    const nodeVisuals2D: Record<string, { color: string; radius: number }> = {
      PROVIDER: { color: '#7aa2ff', radius: 0.022 * 240 },
      SERVER: { color: '#3ddc97', radius: 0.018 * 240 },
      SWITCH: { color: '#f6c177', radius: 0.014 * 240 },
      MULTIPLEXER: { color: '#e6a7ff', radius: 0.012 * 240 },
      DEMULTIPLEXER: { color: '#b36cff', radius: 0.012 * 240 },
      REGENERATOR: { color: '#7df1ff', radius: 0.016 * 240 },
      REGENERATION_POINT: { color: '#7df1ff', radius: 0.014 * 240 },
      MODEM: { color: '#ff7d7d', radius: 0.010 * 240 },
      BASE_STATION: { color: '#ffc3a0', radius: 0.020 * 240 },
      SATELLITE: { color: '#9fe7ff', radius: 0.012 * 240 },
      SATELLITE_RASSVET: { color: '#9fe7ff', radius: 0.012 * 240 },
      EQUIPMENT: { color: '#ffffff', radius: 0.010 * 240 },
      MESH_RELAY: { color: '#00e5ff', radius: 0.014 * 240 },
      SMS_GATEWAY: { color: '#ffd740', radius: 0.014 * 240 },
      VSAT_TERMINAL: { color: '#b388ff', radius: 0.016 * 240 },
      OFFLINE_QUEUE: { color: '#69f0ae', radius: 0.012 * 240 },
    };

    if (network) {
      for (const el of network.elements) {
        if (
          el.path &&
          (el.type === 'CABLE_FIBER' ||
            el.type === 'CABLE_COPPER' ||
            el.type === 'CABLE_UNDERGROUND_FIBER' ||
            el.type === 'CABLE_UNDERGROUND_COPPER')
        ) {
          const latlngs = el.path
            .map((p) => [p.lat, p.lng] as [number, number])
            .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
          if (latlngs.length < 2) continue;

          const isUnderground =
            el.type === 'CABLE_UNDERGROUND_FIBER' || el.type === 'CABLE_UNDERGROUND_COPPER';

          const color =
            el.type === 'CABLE_FIBER'
              ? '#7aa2ff'
              : el.type === 'CABLE_COPPER'
                ? '#f6c177'
                : el.type === 'CABLE_UNDERGROUND_FIBER'
                  ? '#4fd7ff'
                  : '#ffd28a';

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

          L.polyline(latlngs, {
            color,
            weight: 2,
            opacity: isUnderground ? 0.72 : 0.9,
            dashArray: isUnderground ? '6, 5' : undefined,
          })
            .bindTooltip(
              `<b>${escapeHtml(String(el.name || el.type))}</b>` +
                (provider ? `<br/>Провайдер: ${escapeHtml(provider)}` : '') +
                (year ? `<br/>Год: ${escapeHtml(year)}` : '') +
                (countries ? `<br/>Страны: ${escapeHtml(countries)}` : '') +
                sourcesHtml,
              { sticky: true, className: 'map-tooltip' },
            )
            .addTo(group);
        } else if (typeof el.lat === 'number' && typeof el.lng === 'number') {
          if ((el.type === 'SATELLITE' || el.type === 'SATELLITE_RASSVET') && leafletZoom < SATELLITE_MIN_VISIBLE_ZOOM)
            continue;
          const visual = nodeVisuals2D[el.type];
          if (!visual) continue;

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

          L.circleMarker([el.lat, el.lng], {
            radius: Math.max(2, visual.radius),
            color: visual.color,
            weight: 1,
            opacity: 0.9,
            fillColor: visual.color,
            fillOpacity: 0.62,
          })
            .bindTooltip(
              `<b>${escapeHtml(String(el.name || el.type))}</b>` +
                (nodeProvider ? `<br/>Провайдер: ${escapeHtml(nodeProvider)}` : '') +
                (nodeCountries ? `<br/>${escapeHtml(nodeCountries)}` : '') +
                nodeSourcesHtml,
              { sticky: true, className: 'map-tooltip' },
            )
            .addTo(group);
        }
      }
    }
  }, [network, mapReady, mapZoom, providerNameById, providerSourceUrlById]);

  return <div ref={ref} style={{ height: '100%', width: '100%' }} />;
}

