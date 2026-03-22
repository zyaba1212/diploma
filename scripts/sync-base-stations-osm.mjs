/**
 * Импорт базовых станций (telecom towers) из OpenStreetMap (Overpass API).
 *
 * В модели это заполняет `NetworkElement.type = BASE_STATION` с `lat/lng`.
 * Ожидаем, что OSM содержит точечные объекты telecom/towers в интересующем регионе.
 *
 * Источник:
 * - OpenStreetMap data under ODbL 1.0.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BASE_PROVIDER_ID = "osm-base-stations";
const PROVIDER_NAME = "OpenStreetMap — Telecom towers (base stations)";
const PROVIDER_SOURCE_URL = "https://www.openstreetmap.org/";
const PROVIDER_LICENSE_NOTE = "OpenStreetMap data © contributors, ODbL 1.0 — include attribution (per ODbL).";

function parseArgs(argv) {
  let dryRun = false;
  let limit = 200;
  let scope = "GLOBAL";
  let bbox = null;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--limit needs a positive number");
      limit = n;
    } else if (a === "--scope") {
      scope = String(argv[++i] ?? "").toUpperCase();
      if (scope !== "GLOBAL" && scope !== "LOCAL") throw new Error("--scope must be GLOBAL or LOCAL");
    } else if (a === "--bbox") {
      const raw = String(argv[++i] ?? "");
      const parts = raw.split(",").map((p) => Number(p.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error("--bbox needs 4 numbers");
      bbox = parts;
    }
  }

  return { dryRun, limit, scope, bbox };
}

function providerIdForScope(scope) {
  return scope === "GLOBAL" ? BASE_PROVIDER_ID : `${BASE_PROVIDER_ID}-local`;
}

async function computeDefaultBboxFromUndergroundCables(scope) {
  const fallback = [-28.0845, 153.362, -27.9102, 153.4808];

  const elements = await prisma.networkElement.findMany({
    where: {
      scope,
      type: { in: ["CABLE_UNDERGROUND_FIBER", "CABLE_UNDERGROUND_COPPER"] },
      path: { not: null },
    },
    select: { path: true },
  });

  const lats = [];
  const lngs = [];
  for (const el of elements) {
    const path = el.path;
    if (!Array.isArray(path)) continue;
    for (const p of path) {
      if (!p || typeof p !== "object") continue;
      const lat = p.lat;
      const lng = p.lng;
      if (typeof lat === "number" && Number.isFinite(lat)) lats.push(lat);
      if (typeof lng === "number" && Number.isFinite(lng)) lngs.push(lng);
    }
  }

  if (lats.length < 2 || lngs.length < 2) return fallback;

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const pad = 0.05;
  return [minLat - pad, minLng - pad, maxLat + pad, maxLng + pad];
}

function buildOverpassQuery(minLat, minLng, maxLat, maxLng) {
  const timeout = 180;
  // Keep tag selection intentionally broad (OSM coverage varies).
  return `
[out:json][timeout:${timeout}];
(
  node
    ["man_made"~"(communications_tower|communication_tower|telecommunication_tower|cell_tower|mast)"]
    (${minLat},${minLng},${maxLat},${maxLng});
  way
    ["man_made"~"(communications_tower|communication_tower|telecommunication_tower|cell_tower|mast)"]
    (${minLat},${minLng},${maxLat},${maxLng});
);
out center tags;
`;
}

async function fetchOverpass(query) {
  const endpoint = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: query,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

function getLatLng(feature) {
  if (!feature || typeof feature !== "object") return null;
  if (typeof feature.lat === "number" && typeof feature.lon === "number") return { lat: feature.lat, lng: feature.lon };
  if (feature.center && typeof feature.center.lat === "number" && typeof feature.center.lon === "number") {
    return { lat: feature.center.lat, lng: feature.center.lon };
  }
  // Sometimes center keys are `lat/lon` not `lat/lng`.
  if (feature.center && typeof feature.center.lat === "number" && typeof feature.center.lng === "number") {
    return { lat: feature.center.lat, lng: feature.center.lng };
  }
  return null;
}

function sourceIdForFeature(scope, osmType, osmId) {
  const t = osmType.toLowerCase();
  return scope === "GLOBAL" ? `osm-base-station-${t}-${osmId}` : `osm-base-station-local-${t}-${osmId}`;
}

async function main() {
  const { dryRun, limit, scope, bbox } = parseArgs(process.argv);
  const providerId = providerIdForScope(scope);

  console.log(`Import scope: ${scope}`);

  let finalBbox = bbox;
  if (!finalBbox) {
    finalBbox = await computeDefaultBboxFromUndergroundCables(scope);
    console.log(`Computed bbox from underground cables: ${finalBbox.join(",")}`);
  }
  const [minLat, minLng, maxLat, maxLng] = finalBbox;

  const query = buildOverpassQuery(minLat, minLng, maxLat, maxLng);
  if (dryRun) console.log("DRY RUN — no DB writes");

  const data = await fetchOverpass(query);
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  console.log(`Overpass returned features: ${elements.length}`);

  const upserts = [];
  let imported = 0;
  for (const el of elements) {
    if (imported >= limit) break;
    if (!el?.id || !el?.type) continue;

    const latLng = getLatLng(el);
    if (!latLng) continue;

    const osmType = el.type;
    const osmId = el.id;
    const sourceId = sourceIdForFeature(scope, osmType, osmId);

    const tags = el.tags ?? {};
    const name =
      typeof tags.name === "string" && tags.name.trim().length > 0
        ? tags.name.trim()
        : typeof tags.ref === "string" && tags.ref.trim().length > 0
          ? tags.ref.trim()
          : typeof tags.operator === "string" && tags.operator.trim().length > 0
            ? tags.operator.trim()
            : `OSM base station ${osmId}`;

    upserts.push({
      where: { sourceId },
      create: {
        sourceId,
        scope,
        type: "BASE_STATION",
        providerId,
        name,
        lat: latLng.lat,
        lng: latLng.lng,
        altitude: null,
        metadata: {
          dataset: "openstreetmap",
          licenseNote: PROVIDER_LICENSE_NOTE,
          transportMode: "wireless",
          towerType: tags.man_made ?? null,
          osm: { type: osmType, id: osmId, tags },
          importedAt: new Date().toISOString(),
        },
      },
      update: {
        providerId,
        name,
        lat: latLng.lat,
        lng: latLng.lng,
        metadata: {
          dataset: "openstreetmap",
          licenseNote: PROVIDER_LICENSE_NOTE,
          transportMode: "wireless",
          towerType: tags.man_made ?? null,
          osm: { type: osmType, id: osmId, tags },
          importedAt: new Date().toISOString(),
        },
      },
    });
    imported++;
  }

  console.log(`Prepared ${upserts.length} base station(s).`);
  if (dryRun) return;

  await prisma.networkProvider.upsert({
    where: { id: providerId },
    update: { name: PROVIDER_NAME, sourceUrl: `${PROVIDER_SOURCE_URL} (License note: ${PROVIDER_LICENSE_NOTE})`, scope },
    create: { id: providerId, name: PROVIDER_NAME, scope, sourceUrl: `${PROVIDER_SOURCE_URL} (License note: ${PROVIDER_LICENSE_NOTE})` },
  });

  const BATCH = 25;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const chunk = upserts.slice(i, i + BATCH);
    await prisma.$transaction(chunk.map((args) => prisma.networkElement.upsert(args)));
  }

  console.log("Import finished OK.");
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

