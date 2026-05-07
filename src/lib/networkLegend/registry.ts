// networkLegend/registry — единый источник для легенд карт (sandbox / proposal / globe).
//
// Цвета берём из канонических источников (NODE_VISUALS, CABLE_COLORS), подписи — из TYPE_LABELS_RU.
// Любой UI-консьюмер обязан рендерить элементы только через этот реестр + helpers из `./render`.

import { CABLE_COLORS, NODE_VISUALS, TYPE_LABELS_RU } from '@/lib/three/factories';

export type LegendItemKind = 'node' | 'line';
export type LegendDash = 'solid' | 'dashed' | 'satellite';

export interface LegendItem {
  /** Network element type (e.g. SERVER, CABLE_FIBER) или семантический ключ (например, SATELLITE_BACKHAUL). */
  type: string;
  label: string;
  kind: LegendItemKind;
  /** Hex (#rrggbb). Берём из канонических токенов. */
  color: string;
  dash?: LegendDash;
  /**
   * Если задано — иконка/цвет узла в легенде берутся по этому реальному NetworkElementType,
   * а `type` остаётся уникальным семантическим ключом строки (не путать с enum БД).
   */
  visualType?: string;
  /** Подсказка варианта иконки (gateway-primary/core/...) — пробрасывается в getProposalNodeLegendSvg. */
  role?: string;
  /** True если type соответствует реальному ElementType (для построения интерактивных селекторов в /sandbox). */
  isElementType?: boolean;
}

export type LegendGroupId =
  | 'equipment'
  | 'offline'
  | 'cables'
  | 'logical'
  | 'scenario_digital_ruble_minsk';

export interface LegendGroup {
  id: LegendGroupId;
  title: string;
  items: LegendItem[];
}

function nodeColor(type: string): string {
  const v = NODE_VISUALS[type];
  if (!v) return '#8ab4f8';
  return '#' + v.color.toString(16).padStart(6, '0');
}

/** Особый ключ для логической satellite-связи (используется и в renderer'ах: см. MapView/networks/[id]). */
export const SATELLITE_BACKHAUL_KEY = 'SATELLITE_BACKHAUL';
export const SATELLITE_BACKHAUL_COLOR = '#8ab4f8';

/** Семантические ключи строк легенды для референс-сценария (не значения NetworkElementType). */
export const SCENARIO_DR_PAYER_DEVICE = 'SCENARIO_DR_PAYER_DEVICE';
export const SCENARIO_DR_MERCHANT_POS = 'SCENARIO_DR_MERCHANT_POS';

/**
 * Дополнительная группа легенды: роли сценария «офлайн-платёж цифрового рубля (Минск)».
 * Показывать только если в графе есть `metadata.scenario === 'digital-ruble-offline-minsk'` (см. scenarioDetection).
 */
export const DIGITAL_RUBLE_MINSK_LEGEND_GROUP: LegendGroup = {
  id: 'scenario_digital_ruble_minsk',
  title: 'Сценарий: офлайн-платёж цифрового рубля (Минск)',
  items: [
    {
      type: SCENARIO_DR_PAYER_DEVICE,
      kind: 'node',
      label: 'Клиент (плательщик); в БД — MODEM',
      color: nodeColor('MODEM'),
      visualType: 'MODEM',
      role: 'payer',
    },
    {
      type: SCENARIO_DR_MERCHANT_POS,
      kind: 'node',
      label: 'Точка продаж (POS); в БД — OFFLINE_QUEUE',
      color: nodeColor('OFFLINE_QUEUE'),
      visualType: 'OFFLINE_QUEUE',
      role: 'merchant',
    },
  ],
};

export const NETWORK_LEGEND_GROUPS: LegendGroup[] = [
  {
    id: 'equipment',
    title: 'Оборудование',
    items: [
      { type: 'SERVER', kind: 'node', label: TYPE_LABELS_RU.SERVER, color: nodeColor('SERVER'), isElementType: true },
      { type: 'SWITCH', kind: 'node', label: TYPE_LABELS_RU.SWITCH, color: nodeColor('SWITCH'), isElementType: true },
      { type: 'MULTIPLEXER', kind: 'node', label: TYPE_LABELS_RU.MULTIPLEXER, color: nodeColor('MULTIPLEXER'), isElementType: true },
      { type: 'DEMULTIPLEXER', kind: 'node', label: TYPE_LABELS_RU.DEMULTIPLEXER, color: nodeColor('DEMULTIPLEXER'), isElementType: true },
      { type: 'BASE_STATION', kind: 'node', label: TYPE_LABELS_RU.BASE_STATION, color: nodeColor('BASE_STATION'), isElementType: true },
      { type: 'REGENERATOR', kind: 'node', label: TYPE_LABELS_RU.REGENERATOR, color: nodeColor('REGENERATOR'), isElementType: true },
      { type: 'SATELLITE', kind: 'node', label: TYPE_LABELS_RU.SATELLITE, color: nodeColor('SATELLITE') },
    ],
  },
  {
    id: 'offline',
    title: 'Офлайн-инфраструктура',
    items: [
      { type: 'MESH_RELAY', kind: 'node', label: TYPE_LABELS_RU.MESH_RELAY, color: nodeColor('MESH_RELAY'), isElementType: true },
      { type: 'SMS_GATEWAY', kind: 'node', label: TYPE_LABELS_RU.SMS_GATEWAY, color: nodeColor('SMS_GATEWAY'), isElementType: true },
      { type: 'VSAT_TERMINAL', kind: 'node', label: TYPE_LABELS_RU.VSAT_TERMINAL, color: nodeColor('VSAT_TERMINAL'), isElementType: true },
      { type: 'MODEM', kind: 'node', label: TYPE_LABELS_RU.MODEM, color: nodeColor('MODEM') },
      { type: 'OFFLINE_QUEUE', kind: 'node', label: TYPE_LABELS_RU.OFFLINE_QUEUE, color: nodeColor('OFFLINE_QUEUE') },
    ],
  },
  {
    id: 'cables',
    title: 'Кабели',
    items: [
      { type: 'CABLE_FIBER', kind: 'line', label: TYPE_LABELS_RU.CABLE_FIBER, color: CABLE_COLORS.CABLE_FIBER, dash: 'solid', isElementType: true },
      { type: 'CABLE_COPPER', kind: 'line', label: TYPE_LABELS_RU.CABLE_COPPER, color: CABLE_COLORS.CABLE_COPPER, dash: 'solid', isElementType: true },
      { type: 'CABLE_UNDERGROUND_FIBER', kind: 'line', label: TYPE_LABELS_RU.CABLE_UNDERGROUND_FIBER, color: CABLE_COLORS.CABLE_UNDERGROUND_FIBER, dash: 'dashed', isElementType: true },
      { type: 'CABLE_UNDERGROUND_COPPER', kind: 'line', label: TYPE_LABELS_RU.CABLE_UNDERGROUND_COPPER, color: CABLE_COLORS.CABLE_UNDERGROUND_COPPER, dash: 'dashed', isElementType: true },
    ],
  },
  {
    id: 'logical',
    title: 'Логические связи',
    items: [
      { type: SATELLITE_BACKHAUL_KEY, kind: 'line', label: 'Спутниковый канал', color: SATELLITE_BACKHAUL_COLOR, dash: 'satellite' },
    ],
  },
];

/** O(1) lookup по type. Удобно для sandbox-кнопок и rendering helpers. */
const ITEM_INDEX: Record<string, LegendItem> = (() => {
  const acc: Record<string, LegendItem> = {};
  for (const g of NETWORK_LEGEND_GROUPS) {
    for (const it of g.items) acc[it.type] = it;
  }
  return acc;
})();

export function getLegendItem(type: string): LegendItem | null {
  return ITEM_INDEX[type] ?? null;
}

/** Краткая подпись для sandbox (например: "Сервер" / "Оптоволокно подводное"). */
export const SANDBOX_LEGEND_SHORT_LABEL: Record<string, string> = {
  SERVER: 'Сервер',
  SWITCH: 'Коммутатор',
  MULTIPLEXER: 'Мультиплексор',
  DEMULTIPLEXER: 'Демультиплексор',
  BASE_STATION: 'Базовая станция',
  REGENERATOR: 'Регенератор',
  MESH_RELAY: 'Mesh-ретранслятор',
  SMS_GATEWAY: 'SMS-шлюз (2G)',
  VSAT_TERMINAL: 'VSAT-терминал',
  CABLE_FIBER: 'Подводный оптовол.',
  CABLE_COPPER: 'Подводный медный',
  CABLE_UNDERGROUND_FIBER: 'Подземный оптовол.',
  CABLE_UNDERGROUND_COPPER: 'Подземный медный',
};
