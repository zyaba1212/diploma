'use client';

import { useState, useEffect, type CSSProperties } from 'react';

import { Button } from '@/components/ui/Button';
import { colors } from '@/theme/colors';
import type { LegendGroup } from '@/lib/networkLegend/registry';
import { NETWORK_LEGEND_GROUPS } from '@/lib/networkLegend/registry';
import { NetworkLegendItemRow } from '@/lib/networkLegend/render';

const LEGEND_SURFACE_STYLE: CSSProperties = {
  background: 'var(--panel)',
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
};

/** Содержимое легенды сети предложения. По умолчанию — `NETWORK_LEGEND_GROUPS`; на `/networks/[id]` можно передать расширенный список (сценарий). */
export function ProposalLegendBody({ groups = NETWORK_LEGEND_GROUPS }: { groups?: LegendGroup[] }) {
  return (
    <div
      style={{
        color: colors.text.primary,
        fontSize: 11,
        lineHeight: 1.7,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: colors.text.primary }}>Легенда сети</div>
      {groups.map((group) => (
        <div key={group.id} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: colors.text.secondary ?? colors.text.primary,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 3,
              opacity: 0.7,
            }}
          >
            {group.title}
          </div>
          <div style={{ display: 'grid', rowGap: 4 }}>
            {group.items.map((item) => (
              <NetworkLegendItemRow key={`${group.id}:${item.type}`} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Кнопка + раскрываемая панель (как на /global-network). */
export function ProposalCollapsibleLegend({ groups = NETWORK_LEGEND_GROUPS }: { groups?: LegendGroup[] }) {
  const [open, setOpen] = useState(false);
  const [viewportNarrow, setViewportNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => setViewportNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <>
      {open && viewportNarrow ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9,
            background: 'rgba(0,0,0,0.22)',
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          zIndex: 1000,
          maxWidth: 'min(280px, calc(100vw - 24px))',
          pointerEvents: 'auto',
        }}
      >
        {open ? (
          <div
            id="proposal-legend-panel"
            role="dialog"
            aria-modal={viewportNarrow ? 'true' : undefined}
            aria-label="Легенда сети предложения"
            onClick={(e) => e.stopPropagation()}
            style={{
              ...LEGEND_SURFACE_STYLE,
              marginBottom: 8,
              padding: '10px 14px',
              maxHeight: 'min(40vh, 320px)',
              overflowY: 'auto',
            }}
          >
            <ProposalLegendBody groups={groups} />
          </div>
        ) : null}
        <div style={{ ...LEGEND_SURFACE_STYLE, padding: 4, display: 'inline-block' }}>
          <Button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls="proposal-legend-panel"
            style={{ padding: '10px 14px' }}
          >
            {open ? 'Легенда ▲' : 'Легенда ▼'}
          </Button>
        </div>
      </div>
    </>
  );
}
