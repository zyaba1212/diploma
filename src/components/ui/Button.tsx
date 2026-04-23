'use client';

import { ButtonHTMLAttributes } from 'react';
import { colors } from '@/theme/colors';

export function Button({
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'danger' }) {
  const base: React.CSSProperties = {
    appearance: 'none',
    borderRadius: 4,
    border: `1px solid ${colors.accent}`,
    background: 'transparent',
    color: colors.text.primary,
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: 13,
    transition: 'background-color 0.1s ease, color 0.1s ease',
  };
  const danger: React.CSSProperties =
    variant === 'danger'
      ? {
          borderColor: colors.status.failure,
          background: colors.bg.primary,
          color: colors.text.primary,
        }
      : {};

  return <button {...props} style={{ ...base, ...danger, ...(props.style || {}) }} />;
}

