'use client';

import { CSSProperties, ReactNode, useEffect } from 'react';
import { useRef } from 'react';
import { Button } from '@/components/ui/Button';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  closeDisabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    }
    window.addEventListener('keydown', handler);
    queueMicrotask(() => panelRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', handler);
      lastFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const backdrop: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
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
    borderRadius: 4,
    padding: 16,
  };

  return (
    <div style={backdrop} onClick={closeDisabled ? undefined : onClose} role="dialog" aria-modal="true">
      <div ref={panelRef} style={panel} onClick={(e) => e.stopPropagation()} tabIndex={-1}>
        {title ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
            <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Закрыть" disabled={closeDisabled}>
              ×
            </Button>
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
