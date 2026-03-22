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

function buildUpserts(parsed, limit, scope, group, providerId, epochDate, epochIsoFinal) {
  const upserts = [];
  for (const sat of parsed.slice(0, limit)) {
    const noradCatId = sat.line1.substring(2, 7).trim();
    const sourceId = sourceIdForSatellite(scope, group, noradCatId);
    if (!sourceId) continue;

    const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
    const pos = propagateToLatLng(satrec, epochDate);
    if (!pos) continue;

    const name = sat.name || `NORAD ${noradCatId}`;
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
        metadata: {
          dataset: "celestrak-tle",
          licenseNote: PROVIDER_LICENSE_NOTE,
          tle: { group, noradCatId },
          computedAt: epochIsoFinal,
          importedAt: new Date().toISOString(),
        },
      },
      update: {
        providerId,
        name,
        lat: pos.lat,
        lng: pos.lng,
        altitude: pos.altitudeKm,
        metadata: {
          dataset: "celestrak-tle",
          licenseNote: PROVIDER_LICENSE_NOTE,
          tle: { group, noradCatId },
          computedAt: epochIsoFinal,
          importedAt: new Date().toISOString(),
        },
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
      sourceUrl: `${sourceUrl} (License note: ${PROVIDER_LICENSE_NOTE})`,
      scope,
    },
    create: {
      id: providerId,
      name: `${PROVIDER_NAME_BASE} (${group})`,
      scope,
      sourceUrl: `${sourceUrl} (License note: ${PROVIDER_LICENSE_NOTE})`,
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

  const upserts = buildUpserts(parsed, limit, scope, group, providerId, epochDate, epochIsoFinal);
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
      starlinkUpserts = buildUpserts(slParsed, starlinkLimit, scope, slGroup, slProviderId, epochDate, epochIsoFinal);
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

