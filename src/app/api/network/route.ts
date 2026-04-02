import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function parseBbox(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4) return null;
  const [minLat, minLng, maxLat, maxLng] = parts;
  if (![minLat, minLng, maxLat, maxLng].every((n) => Number.isFinite(n))) return null;
  if (minLat > maxLat || minLng > maxLng) return null;
  return [minLat, minLng, maxLat, maxLng];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get('scope');
  const scope = scopeParam === 'LOCAL' ? 'LOCAL' : scopeParam === 'GLOBAL' ? 'GLOBAL' : undefined;
  const bbox = parseBbox(url.searchParams.get('bbox'));

  const whereElements: Record<string, unknown> = {};
  if (scope) whereElements.scope = scope;

  // Only meaningful for LOCAL, but keep behavior permissive:
  if (bbox) {
    const [minLat, minLng, maxLat, maxLng] = bbox;
    whereElements.AND = [
      { lat: { not: null } },
      { lng: { not: null } },
      { lat: { gte: minLat, lte: maxLat } },
      { lng: { gte: minLng, lte: maxLng } },
    ];
  }

  const [providers, elements] = await Promise.all([
    prisma.networkProvider.findMany({
      where: scope ? { scope } : undefined,
      orderBy: { name: 'asc' },
    }),
    prisma.networkElement.findMany({
      where: whereElements,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  return NextResponse.json({ providers, elements }, { headers: { 'cache-control': 'no-store' } });
}

