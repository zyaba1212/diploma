'use client';

import { CSSProperties, ReactNode, useEffect } from 'react';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const backdrop: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  };

  const panel: CSSProperties = {
    width: '100%',
    maxWidth: width,
    maxHeight: '90vh',
    overflow: 'auto',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 16,
    boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
  };

  return (
    <div style={backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {title ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
            <button
              type="button"
              onClick={onClose}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                fontSize: 20,
                cursor: 'pointer',
              }}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        ) : null}
        <div>{children}</div>
        {footer ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8,
              marginTop: 16,
              width: '100%',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
