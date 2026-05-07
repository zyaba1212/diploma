'use client';

import Link, { LinkProps } from 'next/link';
import { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { colors } from '@/theme/colors';

export type ButtonVariant =
  | 'default'
  | 'danger'
  | 'primary'
  | 'destructive'
  | 'solid'
  | 'outline'
  | 'ghost'
  | 'link'
  | 'icon';
export type ButtonTone = 'neutral' | 'accent' | 'danger' | 'success' | 'warning';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon';

type ButtonStyleOptions = {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  disabled?: boolean;
};

function resolveVariant(variant: ButtonVariant): 'solid' | 'outline' | 'ghost' | 'link' | 'icon' {
  if (variant === 'primary') return 'solid';
  if (variant === 'default') return 'outline';
  if (variant === 'danger' || variant === 'destructive') return 'outline';
  return variant;
}

function resolveTone(variant: ButtonVariant, tone: ButtonTone): ButtonTone {
  if (variant === 'danger' || variant === 'destructive') return 'danger';
  if (variant === 'primary') return 'accent';
  return tone;
}

export function getButtonStyle({
  variant = 'outline',
  tone = 'neutral',
  size = 'md',
  disabled = false,
}: ButtonStyleOptions = {}): CSSProperties {
  const resolvedVariant = resolveVariant(variant);
  const resolvedTone = resolveTone(variant, tone);
  const sizeStyles: Record<ButtonSize, CSSProperties> = {
    xs: { padding: '4px 8px', fontSize: 11, borderRadius: 6 },
    sm: { padding: '6px 10px', fontSize: 12, borderRadius: 6 },
    md: { padding: '8px 16px', fontSize: 13, borderRadius: 4 },
    lg: { padding: '10px 18px', fontSize: 14, borderRadius: 6 },
    'icon-sm': {
      width: 28,
      height: 28,
      padding: 0,
      fontSize: 11,
      borderRadius: 6,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
    },
    'icon-md': {
      width: 36,
      height: 36,
      padding: 0,
      fontSize: 14,
      borderRadius: 6,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
    },
    icon: {
      width: 32,
      height: 32,
      padding: 0,
      fontSize: 12,
      borderRadius: 6,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
    },
  };

  const toneStyles: Record<ButtonTone, CSSProperties> = {
    neutral: { borderColor: colors.accent, color: colors.text.primary },
    accent: { borderColor: colors.accent, color: colors.text.primary },
    danger: { borderColor: colors.status.failure, color: colors.text.primary },
    success: { borderColor: colors.status.success, color: colors.text.primary },
    warning: { borderColor: colors.status.offline, color: colors.text.primary },
  };
  const base: CSSProperties = {
    appearance: 'none',
    borderWidth: 1,
    borderStyle: 'solid',
    background: 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background-color 0.1s ease, color 0.1s ease, opacity 0.1s ease',
    opacity: disabled ? 0.6 : 1,
    ...sizeStyles[size],
    ...toneStyles[resolvedTone],
  };
  const variantStyle: CSSProperties =
    resolvedVariant === 'solid'
      ? { background: colors.bg.card }
      : resolvedVariant === 'ghost'
        ? { borderColor: 'transparent', background: 'transparent' }
        : resolvedVariant === 'link'
          ? { borderColor: 'transparent', background: 'transparent', textDecoration: 'underline', paddingLeft: 0, paddingRight: 0 }
          : resolvedVariant === 'icon'
            ? { background: colors.bg.card }
            : {};

  return { ...base, ...variantStyle };
}

export function Button({
  variant = 'outline',
  tone = 'neutral',
  size = 'md',
  loading = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; tone?: ButtonTone; size?: ButtonSize; loading?: boolean }) {
  const buttonStyle = getButtonStyle({ variant, tone, size, disabled: props.disabled || loading });
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      style={{ ...buttonStyle, ...(props.style || {}) }}
    >
      {loading ? '…' : children}
    </button>
  );
}

type ButtonLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    variant?: ButtonVariant;
    tone?: ButtonTone;
    size?: ButtonSize;
    loading?: boolean;
    children: ReactNode;
  };

export function ButtonLink({
  variant = 'outline',
  tone = 'neutral',
  size = 'md',
  loading = false,
  className,
  style,
  children,
  ...props
}: ButtonLinkProps) {
  const buttonStyle = getButtonStyle({ variant, tone, size, disabled: loading });
  return (
    <Link
      {...props}
      className={className ? `touch-target ${className}` : 'touch-target'}
      aria-busy={loading || undefined}
      style={{ ...buttonStyle, textDecoration: 'none', ...(style || {}) }}
    >
      {loading ? '…' : children}
    </Link>
  );
}

