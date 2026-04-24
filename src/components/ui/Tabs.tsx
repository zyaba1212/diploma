'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CSSProperties } from 'react';

export type TabItem = {
  href: string;
  label: string;
  /** Если задано — вкладка видима только для указанных ролей. */
  roles?: Array<'ADMIN' | 'MODERATOR'>;
  badge?: string | number;
};

export function Tabs({ items, role }: { items: TabItem[]; role: 'ADMIN' | 'MODERATOR' | null }) {
  const pathname = usePathname();

  const visible = items.filter((it) => !it.roles || (role && it.roles.includes(role)));

  const wrapper: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    padding: 4,
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: 'var(--panel)',
    marginBottom: 12,
  };

  return (
    <nav style={wrapper} aria-label="Admin navigation">
      {visible.map((it) => {
        const active = pathname === it.href || pathname?.startsWith(`${it.href}/`);
        const linkStyle: CSSProperties = {
          padding: '6px 12px',
          borderRadius: 4,
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active ? 'var(--text)' : 'var(--muted)',
          background: active ? 'var(--table-row-hover)' : 'transparent',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        };
        return (
          <Link key={it.href} href={it.href} style={linkStyle} prefetch={false}>
            <span>{it.label}</span>
            {it.badge != null ? (
              <span
                style={{
                  padding: '0 6px',
                  borderRadius: 4,
                  fontSize: 11,
                  background: 'var(--table-row-hover)',
                }}
              >
                {it.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
