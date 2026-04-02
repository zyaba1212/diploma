'use client';

import { useEffect, useRef } from 'react';
import type { LatLng, NetworkResponseDTO } from '@/lib/types';
import type L from 'leaflet';

export function MapView({
  network,
  center,
  initialCenter,
  userLocation,
  onCenterChanged,
  onMapReady,
  onZoomChanged,
  onError,
}: {
  network: NetworkResponseDTO | null;
  center?: LatLng | null;
  initialCenter?: LatLng | null;
  userLocation?: { lat: number; lng: number; accuracy?: number | null } | null;
  onCenterChanged?: (center: LatLng) => void;
  onMapReady?: (map: L.Map) => void;
  onZoomChanged?: (zoom: number) => void;
  onError?: (msg: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const onCenterChangedRef = useRef<typeof onCenterChanged>(onCenterChanged);
  const onMapReadyRef = useRef<typeof onMapReady>(onMapReady);
  const onZoomChangedRef = useRef<typeof onZoomChanged>(onZoomChanged);
  const lastSetCenterRef = useRef<LatLng | null>(null);
  const initialCenterRef = useRef<LatLng | null | undefined>(initialCenter);
  const pendingCenterRef = useRef<LatLng | null>(null);
  const onErrorRef = useRef<typeof onError>(onError);

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
    onZoomChangedRef.current = onZoomChanged;
  }, [onZoomChanged]);

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
        attribution: '© OSM',
      }).addTo(map);

      const group = L.layerGroup();
      group.addTo(map);
      layerRef.current = group;

      const onMoveEnd = () => {
        const c = map.getCenter();
        onCenterChangedRef.current?.({ lat: c.lat, lng: c.lng });
      };
      const onZoomEnd = () => {
        onZoomChangedRef.current?.(map.getZoom());
      };
      map.on('moveend', onMoveEnd);
      map.on('zoomend', onZoomEnd);
      onMoveEnd();
      onZoomEnd();
    })();

    return () => {
      cancelled = true;
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
    const L = leafletRef.current;
    const group = layerRef.current;
    if (!L || !group) return;

    group.clearLayers();

    const nodeVisuals2D: Record<string, { color: string; radius: number }> = {
      PROVIDER: { color: '#7aa2ff', radius: 0.022 * 240 },
      SERVER: { color: '#3ddc97', radius: 0.018 * 240 },
      SWITCH: { color: '#f6c177', radius: 0.014 * 240 },
      MULTIPLEXER: { color: '#e6a7ff', radius: 0.012 * 240 },
      DEMULTIPLEXER: { color: '#b36cff', radius: 0.012 * 240 },
      REGENERATOR: { color: '#7df1ff', radius: 0.016 * 240 },
      MODEM: { color: '#ff7d7d', radius: 0.010 * 240 },
      BASE_STATION: { color: '#ffc3a0', radius: 0.020 * 240 },
      SATELLITE: { color: '#9fe7ff', radius: 0.012 * 240 },
      EQUIPMENT: { color: '#ffffff', radius: 0.010 * 240 },
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

          const provider = el.providerId
            ? network.providers.find((p) => p.id === el.providerId)?.name
            : '';
          const countries = el.metadata?.countries
            ? Array.isArray(el.metadata.countries)
              ? (el.metadata.countries as string[]).join(', ')
              : String(el.metadata.countries)
            : '';

          L.polyline(latlngs, {
            color,
            weight: 2,
            opacity: isUnderground ? 0.72 : 0.9,
            dashArray: isUnderground ? '6, 5' : undefined,
          })
            .bindTooltip(
              `<b>${el.name || el.type}</b>` +
                (provider ? `<br/>Провайдер: ${provider}` : '') +
                (countries ? `<br/>${countries}` : ''),
              { sticky: true, className: 'map-tooltip' },
            )
            .addTo(group);
        } else if (typeof el.lat === 'number' && typeof el.lng === 'number') {
          const visual = nodeVisuals2D[el.type];
          if (!visual) continue;

          const nodeProvider = el.providerId
            ? network.providers.find((p) => p.id === el.providerId)?.name
            : '';
          const nodeCountries = el.metadata?.countries
            ? Array.isArray(el.metadata.countries)
              ? (el.metadata.countries as string[]).join(', ')
              : String(el.metadata.countries)
            : '';

          L.circleMarker([el.lat, el.lng], {
            radius: Math.max(2, visual.radius),
            color: visual.color,
            weight: 1,
            opacity: 0.9,
            fillColor: visual.color,
            fillOpacity: 0.62,
          })
            .bindTooltip(
              `<b>${el.name || el.type}</b>` +
                (nodeProvider ? `<br/>Провайдер: ${nodeProvider}` : '') +
                (nodeCountries ? `<br/>${nodeCountries}` : ''),
              { sticky: true, className: 'map-tooltip' },
            )
            .addTo(group);
        }
      }
    }

    // 2D user location marker (with optional accuracy circle).
    if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
      const lat = userLocation.lat;
      const lng = userLocation.lng;

      const accuracy = userLocation.accuracy ?? null;
      if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 1) {
        L.circle([lat, lng], {
          radius: accuracy,
          color: '#00c2ff',
          weight: 1,
          opacity: 0.55,
          fillColor: '#00c2ff',
          fillOpacity: 0.12,
          dashArray: '4, 4',
        }).addTo(group);
      }

      L.circleMarker([lat, lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        opacity: 0.95,
        fillColor: '#00c2ff',
        fillOpacity: 0.85,
      }).addTo(group);
    }
  }, [network, userLocation]);

  return <div ref={ref} style={{ height: '100%', width: '100%' }} />;
}

