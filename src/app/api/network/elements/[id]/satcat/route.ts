import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// NOTE: This endpoint is retained as an operational/manual fallback tool.
// UI cards should read owner/launch from /api/network payload metadata directly.

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type SatcatSummary = {
  owner: string | null;
  launchDate: string | null;
  launchYear: number | null;
};

type CacheEntry = {
  value: SatcatSummary;
  expiresAt: number;
};

const cacheStore = globalThis as unknown as {
  __satcatCacheByNorad?: Map<string, CacheEntry>;
};

function getCache(): Map<string, CacheEntry> {
  if (!cacheStore.__satcatCacheByNorad) cacheStore.__satcatCacheByNorad = new Map();
  return cacheStore.__satcatCacheByNorad;
}

const SATCAT_BASE_URL = process.env.CELESTRAK_SATCAT_URL || 'https://celestrak.org/satcat/records.php';
const SATCAT_TIMEOUT_MS = Number(process.env.CELESTRAK_SATCAT_TIMEOUT_MS || 7000);
const SATCAT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeSatcatRecord(raw: unknown): SatcatSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const ownerRaw = rec.OWNER ?? rec.owner ?? rec.ownerName ?? rec.owner_name ?? null;
  const launchDateRaw = rec.LAUNCH_DATE ?? rec.launchDate ?? rec.launch_date ?? null;
  const launchYearRaw = rec.LAUNCH_YEAR ?? rec.launchYear ?? rec.launch_year ?? null;

  const owner = typeof ownerRaw === 'string' ? ownerRaw.trim() : '';
  const launchDate = typeof launchDateRaw === 'string' ? launchDateRaw.trim() : '';
  const launchYearFromDate =
    launchDate.match(/^(\d{4})-/)?.[1] && Number(launchDate.match(/^(\d{4})-/)?.[1]);
  const launchYear =
    typeof launchYearRaw === 'number'
      ? launchYearRaw
      : typeof launchYearRaw === 'string' && /^\d{4}$/.test(launchYearRaw.trim())
        ? Number(launchYearRaw.trim())
        : launchYearFromDate && Number.isFinite(launchYearFromDate)
          ? launchYearFromDate
          : null;

  return {
    owner: owner || null,
    launchDate: launchDate || null,
    launchYear: Number.isFinite(launchYear) ? launchYear : null,
  };
}

function pickMetadataSatcat(metadata: unknown): SatcatSummary | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const owner = typeof m.owner === 'string' && m.owner.trim() ? m.owner.trim() : null;
  const launchDate = typeof m.launchDate === 'string' && m.launchDate.trim() ? m.launchDate.trim() : null;
  const launchYear =
    typeof m.launchYear === 'number'
      ? m.launchYear
      : typeof m.launchYear === 'string' && /^\d{4}$/.test(m.launchYear.trim())
        ? Number(m.launchYear.trim())
        : null;
  if (!owner && !launchDate && !launchYear) return null;
  return { owner, launchDate, launchYear };
}

function extractNoradCatId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const tle = m.tle && typeof m.tle === 'object' ? (m.tle as Record<string, unknown>) : null;
  const norad = tle?.noradCatId;
  if (norad === null || norad === undefined) return null;
  if (typeof norad === 'number' && Number.isFinite(norad) && norad >= 0) return String(Math.trunc(norad));
  if (typeof norad === 'bigint') return String(norad);
  if (typeof norad === 'string') {
    const trimmed = norad.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

async function fetchSatcatSummary(noradCatId: string): Promise<SatcatSummary | null> {
  const cached = getCache().get(noradCatId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SATCAT_TIMEOUT_MS);
  try {
    const url = `${SATCAT_BASE_URL}?CATNR=${encodeURIComponent(noradCatId)}&FORMAT=JSON`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`satcat http ${res.status}`);
    const json = (await res.json().catch(() => null)) as unknown;
    const rows = Array.isArray(json) ? json : [];
    const normalized = normalizeSatcatRecord(rows[0] ?? null);
    if (!normalized) return null;
    getCache().set(noradCatId, { value: normalized, expiresAt: now + SATCAT_CACHE_TTL_MS });
    return normalized;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request, { params }: Params) {
  const clientIp = getClientIp(req);
  const allowed = await checkRateLimit(`network.element.satcat:${clientIp}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  }

  const { id } = await params;
  const elementId = typeof id === 'string' ? id.trim() : '';
  if (!elementId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  try {
    const element = await prisma.networkElement.findUnique({
      where: { id: elementId },
      select: { id: true, type: true, metadata: true },
    });
    if (!element) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (element.type !== 'SATELLITE' && element.type !== 'SATELLITE_RASSVET') {
      return NextResponse.json({ error: 'element is not satellite' }, { status: 400 });
    }

    const existing = pickMetadataSatcat(element.metadata);
    if (existing) {
      return NextResponse.json(
        { elementId: element.id, source: 'metadata', ...existing },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const noradCatId = extractNoradCatId(element.metadata);
    if (!noradCatId) {
      return NextResponse.json({ error: 'missing noradCatId' }, { status: 404 });
    }

    const satcat = await fetchSatcatSummary(noradCatId);
    if (!satcat) return NextResponse.json({ error: 'satcat not found' }, { status: 404 });

    return NextResponse.json(
      { elementId: element.id, source: 'satcat', noradCatId, ...satcat },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
