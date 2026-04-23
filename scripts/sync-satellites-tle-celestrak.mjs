/**
 * Импорт спутников из TLE (Two-Line Elements) с Celestrak.
 *
 * Мы:
 * - скачиваем TLE для выбранного `GROUP`
 * - вычисляем текущие (или заданные) lat/lng + высоту (km) через satellite.js
 * - создаем `NetworkElement.type = SATELLITE`
 *
 * Идемпотентность:
 * - `sourceId` вида `celestrak-tle-<scope?>-${group}-${noradCatId}`
 * - upsert по `sourceId`, чтобы точки обновлялись при повторном запуске.
 */
import { PrismaClient } from "@prisma/client";
import satellite from "satellite.js";

const prisma = new PrismaClient();

const BASE_PROVIDER_ID = "celestrak-tle";
const PROVIDER_NAME_BASE = "Celestrak TLE — Satellites";
const PROVIDER_LICENSE_NOTE =
  "TLE data from Celestrak (check Celestrak terms of use). Provide attribution per source site requirements.";
const SATCAT_BASE_URL = process.env.CELESTRAK_SATCAT_URL || "https://celestrak.org/satcat/records.php";
const SATCAT_TIMEOUT_MS = Number(process.env.CELESTRAK_SATCAT_TIMEOUT_MS || 10_000);
const SATCAT_LOOKUP_CONCURRENCY = Number(process.env.CELESTRAK_SATCAT_CONCURRENCY || 6);

function parseArgs(argv) {
  let dryRun = false;
  let limit = 50;
  let starlinkLimit = 150;
  let scope = "GLOBAL";
  let group = process.env.TLE_GROUP || "active";
  let epochIso = process.env.TLE_EPOCH_ISO || null;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--limit needs a positive number");
      limit = n;
    } else if (a === "--starlink-limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error("--starlink-limit needs a non-negative number");
      starlinkLimit = n;
    } else if (a === "--scope") {
      scope = String(argv[++i] ?? "").toUpperCase();
      if (scope !== "GLOBAL" && scope !== "LOCAL") throw new Error("--scope must be GLOBAL or LOCAL");
    } else if (a === "--group") {
      group = String(argv[++i] ?? "").trim();
      if (!group) throw new Error("--group must be non-empty");
    } else if (a === "--epochIso") {
      epochIso = String(argv[++i] ?? "").trim();
      if (!epochIso) epochIso = null;
    }
  }

  return { dryRun, limit, starlinkLimit, scope, group, epochIso };
}

function providerIdForScope(scope, group) {
  const base = `${BASE_PROVIDER_ID}-${group}`;
  return scope === "GLOBAL" ? base : `${base}-local`;
}

function sourceIdForSatellite(scope, group, noradCatId) {
  if (!noradCatId) return null;
  return scope === "GLOBAL" ? `celestrak-tle-${group}-${noradCatId}` : `celestrak-tle-local-${group}-${noradCatId}`;
}

function parseTleText(tleText) {
  const lines = tleText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = (lines[i] ?? "").trim();
    const line1 = (lines[i + 1] ?? "").trim();
    const line2 = (lines[i + 2] ?? "").trim();
    if (!name || !line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
    out.push({ name, line1, line2 });
  }

  return out;
}

function propagateToLatLng(satrec, epochDate) {
  const posVel = satellite.propagate(satrec, epochDate);
  const positionEci = posVel.position;
  if (!positionEci) return null;

  const gmst = satellite.gstime(epochDate);
  const gd = satellite.eciToGeodetic(positionEci, gmst);

  const latDeg = gd.latitude * (180 / Math.PI);
  const lngDeg = gd.longitude * (180 / Math.PI);
  const heightKm = gd.height; // satellite.js returns km

  return {
    lat: latDeg,
    lng: lngDeg,
    altitudeKm: heightKm,
  };
}

async function fetchTleText(group) {
  const url = process.env.CELESTRAK_TLE_URL || `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Celestrak HTTP ${res.status}`);
  return res.text();
}

function normalizeSatcatRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw;
  const ownerRaw =
    rec.OWNER ??
    rec.owner ??
    rec.owner_name ??
    rec.ownerName ??
    null;
  const launchDateRaw =
    rec.LAUNCH_DATE ??
    rec.launch_date ??
    rec.launchDate ??
    null;
  const owner = typeof ownerRaw === "string" ? ownerRaw.trim() : "";
  const launchDate = typeof launchDateRaw === "string" ? launchDateRaw.trim() : "";
  const launchYearFromDate = launchDate.match(/^(\d{4})-/)?.[1] ?? null;
  const launchYearRaw =
    rec.LAUNCH_YEAR ??
    rec.launch_year ??
    rec.launchYear ??
    launchYearFromDate;
  const launchYearNum =
    typeof launchYearRaw === "number"
      ? launchYearRaw
      : typeof launchYearRaw === "string" && /^\d{4}$/.test(launchYearRaw.trim())
        ? Number(launchYearRaw.trim())
        : null;
  return {
    owner: owner || null,
    launchDate: launchDate || null,
    launchYear: Number.isFinite(launchYearNum) ? launchYearNum : null,
  };
}

async function fetchSatcatByNoradCatId(noradCatId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SATCAT_TIMEOUT_MS);
  try {
    const url = `${SATCAT_BASE_URL}?CATNR=${encodeURIComponent(noradCatId)}&FORMAT=JSON`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`SATCAT HTTP ${res.status}`);
    const json = await res.json().catch(() => null);
    const records = Array.isArray(json) ? json : [];
    const first = records[0];
    const normalized = normalizeSatcatRecord(first);
    return normalized;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: SATCAT lookup failed for ${noradCatId}: ${msg}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildSatcatLookup(parsed, limit) {
  const ids = [...new Set(parsed.slice(0, limit).map((sat) => sat.line1.substring(2, 7).trim()).filter(Boolean))];
  const out = new Map();
  const concurrency = Number.isFinite(SATCAT_LOOKUP_CONCURRENCY) && SATCAT_LOOKUP_CONCURRENCY > 0 ? SATCAT_LOOKUP_CONCURRENCY : 6;
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const rows = await Promise.all(
      chunk.map(async (noradCatId) => {
        const satcat = await fetchSatcatByNoradCatId(noradCatId);
        return { noradCatId, satcat };
      }),
    );
    for (const row of rows) {
      if (row.satcat) out.set(row.noradCatId, row.satcat);
    }
  }
  return out;
}

function buildSatelliteMetadata(group, noradCatId, epochIsoFinal, satcat) {
  const noradStr = typeof noradCatId === "string" ? noradCatId.trim() : String(noradCatId);
  return {
    dataset: "celestrak-tle",
    licenseNote: PROVIDER_LICENSE_NOTE,
    tle: { group, noradCatId: noradStr },
    computedAt: epochIsoFinal,
    importedAt: new Date().toISOString(),
    ...(satcat?.owner ? { owner: satcat.owner } : {}),
    ...(satcat?.launchDate ? { launchDate: satcat.launchDate } : {}),
    ...(satcat?.launchYear ? { launchYear: satcat.launchYear } : {}),
  };
}

function buildUpserts(parsed, limit, scope, group, providerId, epochDate, epochIsoFinal, satcatByNorad) {
  const upserts = [];
  for (const sat of parsed.slice(0, limit)) {
    const noradCatId = sat.line1.substring(2, 7).trim();
    const sourceId = sourceIdForSatellite(scope, group, noradCatId);
    if (!sourceId) continue;

    const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
    const pos = propagateToLatLng(satrec, epochDate);
    if (!pos) continue;

    const name = sat.name || `NORAD ${noradCatId}`;
    const satcat = satcatByNorad.get(noradCatId) ?? null;
    const metadata = buildSatelliteMetadata(group, noradCatId, epochIsoFinal, satcat);
    upserts.push({
      where: { sourceId },
      create: {
        sourceId,
        scope,
        type: "SATELLITE",
        providerId,
        name,
        lat: pos.lat,
        lng: pos.lng,
        altitude: pos.altitudeKm,
        metadata,
      },
      update: {
        providerId,
        name,
        lat: pos.lat,
        lng: pos.lng,
        altitude: pos.altitudeKm,
        metadata,
      },
    });
  }
  return upserts;
}

async function upsertProvider(providerId, scope, group, sourceUrl) {
  await prisma.networkProvider.upsert({
    where: { id: providerId },
    update: {
      name: `${PROVIDER_NAME_BASE} (${group})`,
      sourceUrl,
      scope,
    },
    create: {
      id: providerId,
      name: `${PROVIDER_NAME_BASE} (${group})`,
      scope,
      sourceUrl,
    },
  });
}

async function writeUpserts(upserts) {
  const BATCH = 25;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const chunk = upserts.slice(i, i + BATCH);
    await prisma.$transaction(chunk.map((args) => prisma.networkElement.upsert(args)));
  }
}

async function main() {
  const { dryRun, limit, starlinkLimit, scope, group, epochIso } = parseArgs(process.argv);

  console.log(`Import scope: ${scope}`);
  console.log(`TLE group: ${group}, limit: ${limit}`);
  console.log(`Starlink limit: ${starlinkLimit}`);

  const epochDate = epochIso ? new Date(epochIso) : new Date();
  if (!Number.isFinite(epochDate.getTime())) throw new Error(`Invalid epochIso: ${epochIso}`);
  const epochIsoFinal = epochDate.toISOString();

  if (dryRun) console.log("DRY RUN — no DB writes");

  // --- Primary group ---
  const providerId = providerIdForScope(scope, group);
  const tleText = await fetchTleText(group);
  const parsed = parseTleText(tleText);
  console.log(`Parsed TLE satellites (${group}): ${parsed.length}`);
  const satcatLookup = await buildSatcatLookup(parsed, limit);
  console.log(`Loaded SATCAT metadata for ${satcatLookup.size}/${Math.min(limit, parsed.length)} satellite(s).`);

  const upserts = buildUpserts(parsed, limit, scope, group, providerId, epochDate, epochIsoFinal, satcatLookup);
  console.log(`Prepared ${upserts.length} satellite(s) from '${group}'.`);

  // --- Starlink group ---
  let starlinkUpserts = [];
  if (starlinkLimit > 0) {
    const slGroup = "starlink";
    const slProviderId = providerIdForScope(scope, slGroup);
    try {
      const slText = await fetchTleText(slGroup);
      const slParsed = parseTleText(slText);
      console.log(`Parsed Starlink TLE: ${slParsed.length}`);
      const slSatcatLookup = await buildSatcatLookup(slParsed, starlinkLimit);
      console.log(`Loaded SATCAT metadata for Starlink ${slSatcatLookup.size}/${Math.min(starlinkLimit, slParsed.length)} satellite(s).`);
      starlinkUpserts = buildUpserts(
        slParsed,
        starlinkLimit,
        scope,
        slGroup,
        slProviderId,
        epochDate,
        epochIsoFinal,
        slSatcatLookup,
      );
      console.log(`Prepared ${starlinkUpserts.length} Starlink satellite(s).`);
    } catch (err) {
      console.warn(`Warning: failed to fetch Starlink TLEs: ${err.message}`);
    }
  }

  if (dryRun) return;

  // Write providers
  const sourceUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
  await upsertProvider(providerId, scope, group, sourceUrl);

  if (starlinkUpserts.length > 0) {
    const slUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle`;
    await upsertProvider(providerIdForScope(scope, "starlink"), scope, "starlink", slUrl);
  }

  // Write elements
  await writeUpserts(upserts);
  await writeUpserts(starlinkUpserts);

  console.log(`Import finished OK. Total: ${upserts.length + starlinkUpserts.length} satellite(s).`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

