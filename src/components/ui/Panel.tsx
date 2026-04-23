'use client';

import { CSSProperties, ReactNode } from 'react';

export function Panel({
  title,
  children,
  style,
}: {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 16,
        ...style,
      }}
    >
      {title ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{title}</div>
      ) : null}
      {children}
    </section>
  );
}
