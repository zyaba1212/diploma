import type L from 'leaflet';

type ArrowOptions = {
  color: string;
  size?: number;
};

function midpointAndAngle(a: [number, number], b: [number, number]) {
  const lat = (a[0] + b[0]) / 2;
  const lng = (a[1] + b[1]) / 2;
  // CSS rotate: 0deg points right, positive clockwise in screen coords.
  const angle = (Math.atan2(-(b[0] - a[0]), b[1] - a[1]) * 180) / Math.PI;
  return { lat, lng, angle };
}

export function addDirectionalArrow(
  leaflet: typeof L,
  map: L.Map,
  latLngs: [number, number][],
  options: ArrowOptions,
): L.Marker | null {
  if (latLngs.length < 2) return null;
  const size = options.size ?? 12;
  const midIdx = Math.floor((latLngs.length - 1) / 2);
  const a = latLngs[midIdx];
  const b = latLngs[midIdx + 1];
  if (!a || !b) return null;
  const { lat, lng, angle } = midpointAndAngle(a, b);

  const icon = leaflet.divIcon({
    className: 'proposal-link-arrow',
    html: `<div style="transform: rotate(${angle}deg); transform-origin: center;">
      <svg width="${size}" height="${size}" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M2 7h7M7 3l4 4-4 4" fill="none" stroke="${options.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  return leaflet.marker([lat, lng], { icon, interactive: false }).addTo(map);
}
