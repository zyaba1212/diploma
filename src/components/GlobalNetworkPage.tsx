'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { EarthScene } from './EarthScene';

function normalizeSatelliteNameQuery(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function GlobalNetworkPageContent() {
  const searchParams = useSearchParams();
  const satelliteNameQuery = useMemo(
    () => normalizeSatelliteNameQuery(searchParams?.get('sat') ?? null),
    [searchParams],
  );

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden' }}>
      <EarthScene satelliteNameQuery={satelliteNameQuery} />
    </div>
  );
}

export function GlobalNetworkPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden' }} />}>
      <GlobalNetworkPageContent />
    </Suspense>
  );
}

