// HTTP API /api/network — Next.js Route Handler.

import { NextResponse } from 'next/server';
import { Prisma, type NetworkElementType, type Scope } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { pathIntersectsBbox, type BboxTuple } from '@/lib/geo/viewportBbox';

const CABLE_TYPES: NetworkElementType[] = [
  'CABLE_COPPER',
  'CABLE_FIBER',
  'CABLE_UNDERGROUND_COPPER',
  'CABLE_UNDERGROUND_FIBER',
];

function parseBbox(value: string | null): BboxTuple | null {
  if (!value) return null;
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4) return null;
  const [minLat, minLng, maxLat, maxLng] = parts;
  if (![minLat, minLng, maxLat, maxLng].every((n) => Number.isFinite(n))) return null;
  if (minLat > maxLat || minLng > maxLng) return null;
  return [minLat, minLng, maxLat, maxLng];
}

function parseZoom(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Из JSON path в массив точек для пересечения с bbox. */
function pathToPoints(path: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(path)) return null;
  const out: Array<{ lat: number; lng: number }> = [];
  for (const p of path) {
    if (!p || typeof p !== 'object') continue;
    const lat = (p as { lat?: unknown }).lat;
    const lng = (p as { lng?: unknown }).lng;
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({ lat, lng });
    }
  }
  return out.length >= 2 ? out : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scopeParam = url.searchParams.get('scope');
  const scope = scopeParam === 'LOCAL' ? 'LOCAL' : scopeParam === 'GLOBAL' ? 'GLOBAL' : undefined;
  const bbox = parseBbox(url.searchParams.get('bbox'));
  const z = parseZoom(url.searchParams.get('z'));

  const worldish =
    bbox &&
    (Math.abs(bbox[3] - bbox[1]) > 160 || Math.abs(bbox[2] - bbox[0]) > 70);

  const pointCap = worldish ? 3000 : z != null && z < 5 ? 3500 : 5000;
  const cableFetchCap = worldish ? 2500 : z != null && z < 6 ? 4500 : 9000;

  try {
    if (!bbox) {
      const whereElements: Record<string, unknown> = {};
      if (scope) whereElements.scope = scope;

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

    const [minLat, minLng, maxLat, maxLng] = bbox;

    const scopeWhere: { scope: Scope } | Record<string, never> = scope ? { scope } : {};

    const [providers, nodesInBbox, cableCandidates] = await Promise.all([
      prisma.networkProvider.findMany({
        where: scope ? { scope } : undefined,
        orderBy: { name: 'asc' },
      }),
      prisma.networkElement.findMany({
        where: {
          ...scopeWhere,
          AND: [
            { lat: { not: null } },
            { lng: { not: null } },
            { lat: { gte: minLat, lte: maxLat } },
            { lng: { gte: minLng, lte: maxLng } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: pointCap,
      }),
      prisma.networkElement.findMany({
        where: {
          ...scopeWhere,
          type: { in: CABLE_TYPES },
          path: { not: Prisma.DbNull },
        },
        orderBy: { createdAt: 'desc' },
        take: cableFetchCap,
      }),
    ]);

    const cablesFiltered = cableCandidates.filter((el) => {
      const pts = pathToPoints(el.path);
      if (!pts) return false;
      return pathIntersectsBbox(pts, bbox);
    });

    const byId = new Map<string, (typeof nodesInBbox)[0]>();
    for (const n of nodesInBbox) byId.set(n.id, n);
    for (const c of cablesFiltered) byId.set(c.id, c);
    const elements = [...byId.values()];

    return NextResponse.json({ providers, elements }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/network failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
