'use client';
// networkLegend/render — общие helpers рендеринга элементов легенды.
//
// Используется в /sandbox sidebar, ProposalLegend, EarthScene GlobeLegendBody.
// Цель: иконки узлов берутся из канонического `getProposalNodeLegendSvg`,
// линии рисуются SVG'шкой с двухпроходным stroke (тёмная подложка + цветная линия)
// — те же визуальные правила, что и на самой карте.

import type { CSSProperties } from 'react';

import { getProposalNodeLegendSvg } from '@/lib/leaflet/proposalNodeIcons';

import type { LegendDash, LegendItem } from './registry';

/**
 * Канон карты — см. docs/map-visual-rules.md (раздел 2):
 * - top weight 3, shadow weight 6 (top + 3)
 * - top opacity 0.92, shadow opacity 0.24
 * - underground top '8,6' / shadow '9,7'
 * - satellite link top '2,6' / shadow '3,7', цвет #8ab4f8
 */
const LEGEND_LINE_TOP_WEIGHT = 3;
const LEGEND_LINE_SHADOW_WEIGHT = 6;
const LEGEND_LINE_TOP_OPACITY = 0.92;
const LEGEND_LINE_SHADOW_OPACITY = 0.24;

const DASH_STYLES: Record<
  LegendDash,
  { topDash: string | undefined; shadowDash: string | undefined }
> = {
  solid: { topDash: undefined, shadowDash: undefined },
  dashed: { topDash: '8,6', shadowDash: '9,7' },
  satellite: { topDash: '2,6', shadowDash: '3,7' },
};

export function getLegendLineStyle(item: LegendItem) {
  const style = DASH_STYLES[item.dash ?? 'solid'];
  return {
    color: item.color,
    weight: LEGEND_LINE_TOP_WEIGHT,
    shadowWeight: LEGEND_LINE_SHADOW_WEIGHT,
    dashArray: style.topDash,
    shadowDashArray: style.shadowDash,
    topOpacity: LEGEND_LINE_TOP_OPACITY,
    shadowOpacity: LEGEND_LINE_SHADOW_OPACITY,
  };
}

export function NetworkLegendNodeIcon({ item, size = 20 }: { item: LegendItem; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      dangerouslySetInnerHTML={{
        __html: getProposalNodeLegendSvg(item.visualType ?? item.type, item.role, size),
      }}
    />
  );
}

export function NetworkLegendLineSample({
  item,
  width = 30,
}: {
  item: LegendItem;
  width?: number;
}) {
  const { topDash, shadowDash } = DASH_STYLES[item.dash ?? 'solid'];
  /** Высота SVG подобрана так, чтобы canonical shadow weight=6 не клипался по краям. */
  const HEIGHT = 10;
  const Y = HEIGHT / 2;
  return (
    <svg
      width={width}
      height={HEIGHT}
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'inline-block', overflow: 'visible' }}
    >
      {/* Shadow pass — те же weight/opacity/dashArray, что и на 2D-карте. */}
      <line
        x1="1"
        y1={Y}
        x2={width - 1}
        y2={Y}
        stroke="#071120"
        strokeWidth={LEGEND_LINE_SHADOW_WEIGHT}
        strokeOpacity={LEGEND_LINE_SHADOW_OPACITY}
        strokeDasharray={shadowDash}
        strokeLinecap="round"
      />
      {/* Top pass — те же weight/opacity/dashArray, что и на 2D-карте. */}
      <line
        x1="1"
        y1={Y}
        x2={width - 1}
        y2={Y}
        stroke={item.color}
        strokeWidth={LEGEND_LINE_TOP_WEIGHT}
        strokeOpacity={LEGEND_LINE_TOP_OPACITY}
        strokeDasharray={topDash}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function NetworkLegendItemRow({
  item,
  textStyle,
}: {
  item: LegendItem;
  textStyle?: CSSProperties;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {item.kind === 'node' ? (
        <NetworkLegendNodeIcon item={item} />
      ) : (
        <NetworkLegendLineSample item={item} />
      )}
      <span style={textStyle}>{item.label}</span>
    </span>
  );
}
