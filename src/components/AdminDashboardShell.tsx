'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import type { StaffRole } from '@prisma/client';

import { TabItem, Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';

const ADMIN_TABS: TabItem[] = [
  { href: '/admin/overview', label: 'Обзор', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/users', label: 'Пользователи', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/proposals', label: 'Предложения', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/sessions', label: 'Сессии', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/audit', label: 'Журнал Администрации', roles: ['ADMIN', 'MODERATOR'] },
];

function staffIdentityLine(username: string | null | undefined, pubkey: string | null | undefined): string | null {
  if (username) return username;
  if (pubkey && pubkey.length > 12) return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
  if (pubkey) return pubkey;
  return null;
}

export function AdminDashboardShell({
  role,
  staffUsername,
  staffPubkey,
  children,
}: {
  role: StaffRole;
  staffUsername?: string | null;
  staffPubkey?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const identity = staffIdentityLine(staffUsername, staffPubkey);

  const logout = useCallback(async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    router.replace('/admin/login');
    router.refresh();
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Админ-панель</h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
            Роль: <strong>{role}</strong>
            {identity ? (
              <>
                {' '}
                · username: <strong>{identity}</strong>
              </>
            ) : null}
          </p>
        </div>
        <Button type="button" onClick={() => void logout()}>
          Выйти
        </Button>
      </div>

      <Tabs items={ADMIN_TABS} role={role} />
      {children}
    </div>
  );
}
