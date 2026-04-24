'use client';

import type { CSSProperties } from 'react';

import { getProposalNodeLegendSvg } from '@/lib/leaflet/proposalNodeIcons';

function lineSample(style: CSSProperties) {
  return (
    <span
      style={{
        width: 24,
        height: 0,
        borderTopWidth: style.borderTopWidth ?? 2,
        borderTopStyle: style.borderTopStyle ?? 'solid',
        borderTopColor: style.borderTopColor ?? '#8ab4f8',
        display: 'inline-block',
      }}
    />
  );
}

export function ProposalLegend() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
        zIndex: 1000,
        background: 'rgba(8,14,28,0.92)',
        border: '1px solid rgba(120,160,255,0.25)',
        borderRadius: 8,
        padding: '10px 12px',
        minWidth: 232,
        color: '#d7e6ff',
        fontSize: 11,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Легенда сети</div>
      <div style={{ display: 'grid', rowGap: 4, marginBottom: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lineSample({ borderTopColor: '#3a7bd5', borderTopStyle: 'solid', borderTopWidth: 3 })} Mesh chain
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lineSample({ borderTopColor: '#00e676', borderTopStyle: 'solid', borderTopWidth: 4 })} Primary uplink
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lineSample({ borderTopColor: '#ff7043', borderTopStyle: 'dashed', borderTopWidth: 3 })} Backup uplink
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lineSample({ borderTopColor: '#d4a54a', borderTopStyle: 'dotted', borderTopWidth: 2 })} Return path
        </span>
      </div>
      <div style={{ display: 'grid', rowGap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span dangerouslySetInnerHTML={{ __html: getProposalNodeLegendSvg('MODEM', 'payer') }} />
          Client A
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span dangerouslySetInnerHTML={{ __html: getProposalNodeLegendSvg('OFFLINE_QUEUE', 'merchant') }} />
          Merchant POS
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span dangerouslySetInnerHTML={{ __html: getProposalNodeLegendSvg('MESH_RELAY', 'mesh') }} />
          Mesh relay
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span dangerouslySetInnerHTML={{ __html: getProposalNodeLegendSvg('SWITCH', 'gateway-primary') }} />
          Gateway
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span dangerouslySetInnerHTML={{ __html: getProposalNodeLegendSvg('SERVER', 'core') }} />
          Edge/Core server
        </span>
      </div>
    </div>
  );
}
