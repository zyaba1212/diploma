/**
 * Палитра «Пульт VSAT» — единственные цвета UI и визуализации сети.
 * В TS/React импортируйте `colors`; для THREE.js — `three`.
 */
export const colors = {
  bg: {
    primary: '#1A1D20',
    card: '#252A2E',
    /** Ховер строк таблицы (см. дизайн-систему). */
    tableRowHover: '#2E353A',
  },
  text: {
    primary: '#E6EDF3',
    secondary: '#8D99A6',
  },
  accent: '#F4B642',
  border: '#3E444A',
  status: {
    offline: '#E0872E',
    success: '#4A8C6F',
    failure: '#B3413A',
  },
  /** Фон области карты / глобуса (2D-холст). */
  mapCanvas: '#111315',
  /** Сетка на карте. */
  mapGrid: '#000000',
} as const;

function toThree(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Целочисленные 0xRRGGBB для THREE.js (соответствуют `colors`). */
export const three = {
  bgPrimary: toThree(colors.bg.primary),
  bgCard: toThree(colors.bg.card),
  tableRowHover: toThree(colors.bg.tableRowHover),
  textPrimary: toThree(colors.text.primary),
  textSecondary: toThree(colors.text.secondary),
  accent: toThree(colors.accent),
  border: toThree(colors.border),
  statusOffline: toThree(colors.status.offline),
  statusSuccess: toThree(colors.status.success),
  statusFailure: toThree(colors.status.failure),
  mapCanvas: toThree(colors.mapCanvas),
  mapGrid: toThree(colors.mapGrid),
} as const;
