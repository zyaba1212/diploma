import type L from 'leaflet';

import { NODE_VISUALS } from '@/lib/three/factories';

const FALLBACK_COLOR = '#8ab4f8';

function colorByType(type: string): string {
  const visual = NODE_VISUALS[type];
  if (!visual) return FALLBACK_COLOR;
  return `#${visual.color.toString(16).padStart(6, '0')}`;
}

function svgWrap(inner: string, color: string, size: number) {
  /**
   * Двухпроходный stroke: сначала тёмная "обводка-силуэт" (читаемость на любой OSM-подложке),
   * затем цветной верхний штрих (3D/металлический хайлайт сохранён через linearGradient).
   * Никаких цветных bloom-фильтров здесь — они вынесены в обёртку divIcon как мягкая depth-тень.
   */
  return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="metal-grad-${size}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f7fbff" stop-opacity="0.9"/>
        <stop offset="55%" stop-color="#9bb4d7" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#263445" stop-opacity="0.25"/>
      </linearGradient>
    </defs>
    <ellipse cx="14" cy="24.2" rx="7.6" ry="2.1" fill="rgba(5,10,20,0.34)" />
    <g fill="none" stroke="rgba(8,15,28,0.92)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" paint-order="stroke">
      ${inner}
    </g>
    <g fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" paint-order="stroke">
      ${inner}
    </g>
    <ellipse cx="11.2" cy="10.2" rx="5.6" ry="3.1" fill="url(#metal-grad-${size})" opacity="0.28"/>
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

function multiplexerSvg(color: string, size: number) {
  return svgWrap(
    `
    <ellipse cx="14" cy="14" rx="4.6" ry="7.2" />
    <ellipse cx="14" cy="14" rx="6.8" ry="9.4" />
    <path d="M14 4.8v4.2M14 19v4.2" />
    <path d="M9.6 8.2l-2.8-2.1M18.4 8.2l2.8-2.1" />
    <path d="M9.6 19.8l-2.8 2.1M18.4 19.8l2.8 2.1" />
  `,
    color,
    size,
  );
}

function demultiplexerSvg(color: string, size: number) {
  return svgWrap(
    `
    <path d="M14 5.2v6.8" />
    <path d="M14 12l-6.2 9.6M14 12l0 10M14 12l6.2 9.6" />
    <circle cx="14" cy="4.6" r="1.7" />
    <circle cx="7.2" cy="22.2" r="1.2" />
    <circle cx="14" cy="23.1" r="1.2" />
    <circle cx="20.8" cy="22.2" r="1.2" />
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

function baseStationSvg(color: string, size: number) {
  return svgWrap(
    `
    <path d="M14 4.2v15.8" />
    <path d="M9.2 20h9.6" />
    <rect x="11.2" y="20" width="5.6" height="3.6" rx="0.8" />
    <path d="M14 8.1c2.8 0 5.1 2.3 5.1 5.1" />
    <path d="M14 6.2c3.8 0 6.8 3 6.8 6.8" />
    <path d="M14 8.1c-2.8 0-5.1 2.3-5.1 5.1" />
    <path d="M14 6.2c-3.8 0-6.8 3-6.8 6.8" />
  `,
    color,
    size,
  );
}

function regeneratorSvg(color: string, size: number) {
  return svgWrap(
    `
    <rect x="8.2" y="5.2" width="11.6" height="17.6" rx="1.6" />
    <rect x="10.2" y="11.4" width="7.6" height="4.8" rx="1" />
    <path d="M10.5 7.8h7M10.5 9.4h7" />
    <path d="M10.5 18.8h7M10.5 20.4h7" />
    <path d="M8.2 14h-2.5M19.8 14h2.5" />
  `,
    color,
    size,
  );
}

function smsGatewaySvg(color: string, size: number) {
  return svgWrap(
    `
    <rect x="8" y="6.2" width="12" height="16.2" rx="1.8" />
    <path d="M11.2 6.2V3.8M16.8 6.2V3.8" />
    <path d="M13.4 12.2h6" />
    <path d="M13.4 14.2h4.8" />
    <rect x="9.6" y="10.8" width="2.8" height="2.8" rx="0.4" />
    <path d="M10 18.8h8" />
  `,
    color,
    size,
  );
}

function satelliteSvg(color: string, size: number) {
  return svgWrap(
    `
    <circle cx="14" cy="14" r="3.4" fill="${color}" opacity="0.24"/>
    <rect x="8.2" y="12.8" width="3.3" height="2.4" rx="0.5" />
    <rect x="16.5" y="12.8" width="3.3" height="2.4" rx="0.5" />
    <rect x="11.6" y="12.2" width="4.8" height="3.6" rx="0.8" />
    <path d="M14 10.3v-2.3M12.7 8.9h2.6" />
  `,
    color,
    size,
  );
}

function vsatSvg(color: string, size: number) {
  return svgWrap(
    `
    <path d="M8.2 16.8h11.6" />
    <path d="M11.6 16.8l2.4-7.2 2.4 7.2" />
    <ellipse cx="14" cy="9.2" rx="5.4" ry="2.6" transform="rotate(-16 14 9.2)" />
    <path d="M17.4 11.1c1.6 0.4 3.1 1.3 4.1 2.5" />
    <path d="M18.2 8.5c2.2 0.6 4.2 1.9 5.5 3.6" />
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
  if (type === 'MULTIPLEXER') return multiplexerSvg(color, size);
  if (type === 'DEMULTIPLEXER') return demultiplexerSvg(color, size);
  if (type === 'SWITCH') return switchSvg(color, size, role);
  if (type === 'SERVER') return serverSvg(color, size, role);
  if (type === 'BASE_STATION') return baseStationSvg(color, size);
  if (type === 'REGENERATOR' || type === 'REGENERATION_POINT') return regeneratorSvg(color, size);
  if (type === 'SMS_GATEWAY') return smsGatewaySvg(color, size);
  if (type === 'SATELLITE' || type === 'SATELLITE_RASSVET') return satelliteSvg(color, size);
  if (type === 'VSAT_TERMINAL') return vsatSvg(color, size);
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
    if (type === 'MULTIPLEXER') return multiplexerSvg(color, size);
    if (type === 'DEMULTIPLEXER') return demultiplexerSvg(color, size);
    if (type === 'SWITCH') return switchSvg(color, size, role);
    if (type === 'SERVER') return serverSvg(color, size, role);
    if (type === 'BASE_STATION') return baseStationSvg(color, size);
    if (type === 'REGENERATOR' || type === 'REGENERATION_POINT') return regeneratorSvg(color, size);
    if (type === 'SMS_GATEWAY') return smsGatewaySvg(color, size);
    if (type === 'SATELLITE' || type === 'SATELLITE_RASSVET') return satelliteSvg(color, size);
    if (type === 'VSAT_TERMINAL') return vsatSvg(color, size);
    return svgWrap('<circle cx="14" cy="14" r="8.2" />', color, size);
  })();

  /**
   * Depth-тень + аккуратный нейтральный halo вместо цветного bloom: силуэт читается на любой OSM-подложке,
   * 3D-эффект сохранён за счёт mid drop-shadow и внутреннего металлического градиента в svgWrap.
   */
  void color;
  return leaflet.divIcon({
    className: 'proposal-node-icon',
    html: `<div style="width:${size}px;height:${size}px;transform:translateZ(0);filter:drop-shadow(0 2px 3px rgba(8,15,28,0.55)) drop-shadow(0 0 1.4px rgba(8,15,28,0.85));">${iconHtml}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2],
  });
}
