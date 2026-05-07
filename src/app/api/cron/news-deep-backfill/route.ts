import { NextResponse } from 'next/server';

import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cronAuth';
import { runDeepBackfillAllSources } from '@/lib/news/deepBackfill';

function parseParams(req: Request) {
  const url = new URL(req.url);
  const daysBack = Math.min(730, Math.max(1, Number(url.searchParams.get('daysBack')) || 3));
  const maxUrlsPerSource = Math.min(2000, Math.max(5, Number(url.searchParams.get('maxUrls')) || 150));
  const maxSitemapFilesPerSource = Math.min(200, Math.max(5, Number(url.searchParams.get('maxSitemaps')) || 40));
  const fetchMetaTitle = url.searchParams.get('metaTitle') === '1';
  const sourceFilter = url.searchParams.get('source') ?? undefined;
  const dryRun = url.searchParams.get('dryRun') === '1';
  return { daysBack, maxUrlsPerSource, maxSitemapFilesPerSource, fetchMetaTitle, sourceFilter, dryRun };
}

async function run(req: Request) {
  if (!isCronAuthorized(req)) {
    return cronUnauthorizedResponse();
  }
  const { daysBack, maxUrlsPerSource, maxSitemapFilesPerSource, fetchMetaTitle, sourceFilter, dryRun } =
    parseParams(req);
  const { results, totals } = await runDeepBackfillAllSources({
    daysBack,
    maxUrlsPerSource,
    maxSitemapFilesPerSource,
    fetchMetaTitle,
    sourceFilter,
    dryRun,
  });
  return NextResponse.json({ ok: true, dryRun, totals, results });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
