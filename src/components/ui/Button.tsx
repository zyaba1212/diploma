'use client';

import { ButtonHTMLAttributes } from 'react';

export function Button({
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'danger' }) {
  const base: React.CSSProperties = {
    appearance: 'none',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.06)',
    color: 'var(--text)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 13,
  };
  const danger: React.CSSProperties =
    variant === 'danger'
      ? {
          borderColor: 'rgba(255,107,107,0.35)',
          background: 'rgba(255,107,107,0.12)',
        }
      : {};

  return <button {...props} style={{ ...base, ...danger, ...(props.style || {}) }} />;
}

