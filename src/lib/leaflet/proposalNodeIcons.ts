import type L from 'leaflet';

import { NODE_VISUALS } from '@/lib/three/factories';

const FALLBACK_COLOR = '#8ab4f8';

function colorByType(type: string): string {
  const visual = NODE_VISUALS[type];
  if (!visual) return FALLBACK_COLOR;
  return `#${visual.color.toString(16).padStart(6, '0')}`;
}

function svgWrap(inner: string, color: string, size: number) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      ${inner}
    </g>
  </svg>`;
}

function modemSvg(color: string, size: number) {
  return svgWrap(
    `
    <rect x="7" y="3.5" width="14" height="21" rx="3.2"/>
    <rect x="9.2" y="7" width="9.6" height="12.6" rx="1.4"/>
    <circle cx="14" cy="22.1" r="0.8" fill="${color}" />
  `,
    color,
    size,
  );
}

function queueSvg(color: string, size: number) {
  return svgWrap(
    `
    <rect x="5" y="5" width="18" height="18" rx="2.2"/>
    <rect x="8" y="8" width="3.2" height="3.2" fill="${color}" />
    <rect x="16.8" y="8" width="3.2" height="3.2" fill="${color}" />
    <rect x="8" y="16.8" width="3.2" height="3.2" fill="${color}" />
    <rect x="13.4" y="13.4" width="2.2" height="2.2" fill="${color}" />
    <rect x="17.4" y="17.4" width="2.2" height="2.2" fill="${color}" />
  `,
    color,
    size,
  );
}

function meshSvg(color: string, size: number) {
  return svgWrap(
    `
    <polygon points="14,6.2 21.8,14 14,21.8 6.2,14"/>
    <path d="M9.2 9.4c2.7-2.8 6.9-2.8 9.6 0"/>
    <path d="M7.4 7.6c3.8-3.9 9.4-3.9 13.2 0"/>
    <path d="M5.6 5.8c4.8-4.9 12-4.9 16.8 0"/>
  `,
    color,
    size,
  );
}

function switchSvg(color: string, size: number, role?: string) {
  const isPrimary = role === 'gateway-primary';
  const border = isPrimary ? '#f6c177' : color;
  return svgWrap(
    `
    <rect x="4.5" y="7.2" width="19" height="13.6" rx="2.2" stroke="${border}"/>
    <rect x="7.5" y="15.2" width="2" height="2" fill="${border}" />
    <rect x="10.6" y="15.2" width="2" height="2" fill="${border}" />
    <rect x="13.7" y="15.2" width="2" height="2" fill="${border}" />
    <rect x="16.8" y="15.2" width="2" height="2" fill="${border}" />
  `,
    border,
    size,
  );
}

function serverSvg(color: string, size: number, role?: string) {
  const crown = role === 'core'
    ? `<path d="M7.8 5.9l3.1 2.3 3.1-3.1 3.1 3.1 3.1-2.3v4.3H7.8z" fill="${color}" />`
    : '';
  return svgWrap(
    `
    ${crown}
    <rect x="7.1" y="8.2" width="13.8" height="15.2" rx="1.8" />
    <path d="M10 12.1h8M10 15.6h8M10 19.1h8" />
  `,
    color,
    size,
  );
}

export function getProposalNodeLegendSvg(type: string, role?: string, size = 18): string {
  const color = colorByType(type);
  if (type === 'MODEM') return modemSvg(color, size);
  if (type === 'OFFLINE_QUEUE') return queueSvg(color, size);
  if (type === 'MESH_RELAY') return meshSvg(color, size);
  if (type === 'SWITCH') return switchSvg(color, size, role);
  if (type === 'SERVER') return serverSvg(color, size, role);
  return svgWrap('<circle cx="14" cy="14" r="8.2" />', color, size);
}

export function buildProposalNodeDivIcon(
  leaflet: typeof L,
  type: string,
  role?: string,
): L.DivIcon {
  const size = type === 'SERVER' ? 30 : 28;
  const color = colorByType(type);
  const iconHtml = (() => {
    if (type === 'MODEM') return modemSvg(color, size);
    if (type === 'OFFLINE_QUEUE') return queueSvg(color, size);
    if (type === 'MESH_RELAY') return meshSvg(color, size);
    if (type === 'SWITCH') return switchSvg(color, size, role);
    if (type === 'SERVER') return serverSvg(color, size, role);
    return svgWrap('<circle cx="14" cy="14" r="8.2" />', color, size);
  })();

  return leaflet.divIcon({
    className: 'proposal-node-icon',
    html: `<div style="width:${size}px;height:${size}px;filter:drop-shadow(0 0 5px ${color});">${iconHtml}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2],
  });
}
