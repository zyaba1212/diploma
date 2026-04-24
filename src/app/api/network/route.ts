// HTTP API /api/network — Next.js Route Handler.

import { NextResponse } from 'next/server';
import { Prisma, type NetworkElementType, type Scope } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { pathIntersectsBbox, type BboxTuple } from '@/lib/geo/viewportBbox';

const OFFICIAL_DATASETS = new Set([
  'open_undersea_cable_map',
  'gold_coast_fibre_optic_cable',
  'celestrak-tle',
  'openstreetmap',
  'osm_terrestrial_fibre',
  'afterfibre',
  'major-datacenters',
  'fallback-reclassified-from-underground-fiber',
]);

/** Submarine / aerial long-haul lines (Open Undersea Cable Map, etc.). */
const SUBMARINE_CABLE_TYPES: NetworkElementType[] = ['CABLE_COPPER', 'CABLE_FIBER'];

/** Terrestrial underground segments (Gold Coast WFS, OSM telecom, AfTerFibre, …). */
const UNDERGROUND_CABLE_TYPES: NetworkElementType[] = ['CABLE_UNDERGROUND_COPPER', 'CABLE_UNDERGROUND_FIBER'];

/**
 * Dedicated fetch budget for underground cables so they are not evicted from the
 * candidate window by thousands of newer submarine `CABLE_FIBER` rows
 * (same `orderBy: createdAt desc` + shared `take` previously hid all underground).
 */
const UNDERGROUND_CABLE_FETCH_CAP_WORLDISH = 12000;
const UNDERGROUND_CABLE_FETCH_CAP_CLOSE = 7000;

function isOfficialElementByMetadataDataset(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const dataset = (metadata as { dataset?: unknown }).dataset;
  return typeof dataset === 'string' && OFFICIAL_DATASETS.has(dataset);
}

type SourceClass = 'official' | 'osm_verified' | 'synthetic';

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

function metadataSourceClass(metadata: unknown): SourceClass | null {
  const meta = metadataRecord(metadata);
  if (!meta) return null;
  const value = meta.sourceClass;
  return value === 'official' || value === 'osm_verified' || value === 'synthetic' ? value : null;
}

function isUndergroundCable(type: NetworkElementType): boolean {
  return type === 'CABLE_UNDERGROUND_FIBER' || type === 'CABLE_UNDERGROUND_COPPER';
}

function isEligibleDatasetForNetwork(metadata: unknown): boolean {
  return isOfficialElementByMetadataDataset(metadata);
}

function undergroundVisibilityDecision(
  el: { type: NetworkElementType; metadata: unknown },
  worldishView: boolean,
): { include: boolean; reason: string } {
  if (!isUndergroundCable(el.type)) return { include: true, reason: 'non-underground' };
  if (!isOfficialElementByMetadataDataset(el.metadata)) return { include: false, reason: 'dataset-not-eligible' };
  const sourceClass = metadataSourceClass(el.metadata);
  if (sourceClass !== 'official' && sourceClass !== 'osm_verified') return { include: false, reason: 'source-class' };
  if (!worldishView) return { include: true, reason: 'close-view' };
  return { include: true, reason: 'worldish-include' };
}

function shouldIncludeUndergroundCable(el: { type: NetworkElementType; metadata: unknown }, worldishView: boolean): boolean {
  return undergroundVisibilityDecision(el, worldishView).include;
}

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
  const debugUnderground = url.searchParams.get('debugUnderground') === '1';

  const pointCap = worldish ? 3000 : z != null && z < 5 ? 3500 : 5000;
  const cableFetchCap = worldish ? 2500 : z != null && z < 6 ? 4500 : 9000;
  const undergroundFetchCap = worldish ? UNDERGROUND_CABLE_FETCH_CAP_WORLDISH : UNDERGROUND_CABLE_FETCH_CAP_CLOSE;

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

      const officialElements = elements.filter(
        (el) =>
          isEligibleDatasetForNetwork(el.metadata) &&
          undergroundVisibilityDecision(el, false).include,
      );
      return NextResponse.json({ providers, elements: officialElements }, { headers: { 'cache-control': 'no-store' } });
    }

    const [minLat, minLng, maxLat, maxLng] = bbox;

    const scopeWhere: { scope: Scope } | Record<string, never> = scope ? { scope } : {};

    const [providers, nodesInBbox, undergroundCableRows, submarineCableRows] = await Promise.all([
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
          type: { in: UNDERGROUND_CABLE_TYPES },
          path: { not: Prisma.DbNull },
        },
        orderBy: { createdAt: 'desc' },
        take: undergroundFetchCap,
      }),
      prisma.networkElement.findMany({
        where: {
          ...scopeWhere,
          type: { in: SUBMARINE_CABLE_TYPES },
          path: { not: Prisma.DbNull },
        },
        orderBy: { createdAt: 'desc' },
        take: cableFetchCap,
      }),
    ]);

    // Underground first so dedupe keeps terrestrial rows if an id collision ever occurred.
    const cableCandidatesById = new Map<string, (typeof undergroundCableRows)[number]>();
    for (const el of undergroundCableRows) cableCandidatesById.set(el.id, el);
    for (const el of submarineCableRows) {
      if (!cableCandidatesById.has(el.id)) cableCandidatesById.set(el.id, el);
    }
    const cableCandidates = [...cableCandidatesById.values()];

    const cablesFiltered = cableCandidates.filter((el) => {
      const pts = pathToPoints(el.path);
      if (!pts) return false;
      return pathIntersectsBbox(pts, bbox);
    });

    const byId = new Map<string, (typeof nodesInBbox)[0]>();
    for (const n of nodesInBbox) byId.set(n.id, n);
    for (const c of cablesFiltered) byId.set(c.id, c);
    const undergroundRejectionStats = new Map<string, number>();
    const elements = [...byId.values()].filter((el) => {
      if (!isEligibleDatasetForNetwork(el.metadata)) return false;
      if (!isUndergroundCable(el.type)) return true;
      const decision = undergroundVisibilityDecision(el, Boolean(worldish));
      if (!decision.include && debugUnderground) {
        undergroundRejectionStats.set(decision.reason, (undergroundRejectionStats.get(decision.reason) ?? 0) + 1);
      }
      return decision.include;
    });

    if (debugUnderground) {
      const undergroundInCandidateWindow = cableCandidates.filter((el) => isUndergroundCable(el.type)).length;
      const undergroundInResponse = elements.filter((el) => isUndergroundCable(el.type)).length;
      console.info('network underground debug', {
        scope,
        worldish: Boolean(worldish),
        undergroundFetchCap,
        undergroundInCandidateWindow,
        undergroundInResponse,
        rejectionStats: Object.fromEntries(undergroundRejectionStats.entries()),
      });
    }

    return NextResponse.json({ providers, elements }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/network failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
