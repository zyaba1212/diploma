import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Песочница',
};

export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ minHeight: '100vh', padding: 80, color: 'var(--muted)' }}>Загрузка…</div>}>{children}</Suspense>;
}
