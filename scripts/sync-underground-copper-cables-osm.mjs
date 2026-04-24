/**
 * Импорт подземных (underground) телеком-кабелей меди из OpenStreetMap (Overpass API).
 *
 * Используемые теги (OSM wiki "Telecoms"):
 * - `man_made=cable`
 * - `location=underground`
 * - `telecom:medium=copper`
 *
 * Идемпотентность:
 * - `sourceId` вида `osm-underground-telecom-copper-<scope>-way-<wayId>`
 * - `NetworkElement` upsert по `sourceId` (уникален в БД).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BASE_PROVIDER_ID = "osm-underground-telecom-cables-copper";
const PROVIDER_NAME = "OpenStreetMap — Underground telecom cables (copper)";
const PROVIDER_SOURCE_URL = "https://www.openstreetmap.org/";
const PROVIDER_LICENSE_NOTE = "OpenStreetMap data © contributors, ODbL 1.0 — include attribution (per ODbL).";
const OSM_DATASET = "openstreetmap";
const OSM_SOURCE_CLASS = "osm_verified";

const FIBER_FALLBACK_PROVIDER_SOURCE_URL = "https://data.gov.au/data/dataset/fibre-optic-cable";
const FIBER_FALLBACK_PROVIDER_LICENSE_NOTE =
  "CC BY 3.0 Australia — City of Gold Coast. Attribution required; locations/dimensions/depths must be confirmed on site.";

function parseArgs(argv) {
  let dryRun = false;
  let limit = 200;
  let scope = "GLOBAL";
  let bbox = null;
  let fallbackReclassifyFiber = false;

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
    } else if (a === "--fallback-reclassify-fiber") {
      fallbackReclassifyFiber = true;
    }
  }

  return { dryRun, limit, scope, bbox, fallbackReclassifyFiber };
}

function providerIdForScope(scope) {
  return scope === "GLOBAL" ? BASE_PROVIDER_ID : `${BASE_PROVIDER_ID}-local`;
}

function sourceIdForWay(scope, wayId) {
  return scope === "GLOBAL" ? `osm-underground-telecom-copper-way-${wayId}` : `osm-underground-telecom-copper-local-way-${wayId}`;
}

async function computeDefaultBboxFromUndergroundFiber(scope) {
  // Fallback strategy:
  // - if we already have underground fiber in this `scope`, compute bbox from its path points
  // - else use the same approximate box around existing Gold Coast data that is already in this repo
  const fallback = [-28.0845, 153.362, -27.9102, 153.4808];

  const elements = await prisma.networkElement.findMany({
    where: {
      scope,
      type: "CABLE_UNDERGROUND_FIBER",
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

function buildOverpassQuery(minLat, minLng, maxLat, maxLng, limit) {
  // Overpass uses south,west,north,east order.
  const timeout = 180;
  const q = `
[out:json][timeout:${timeout}];
(
  // Most explicit underground telecom cable tagging.
  way
    ["man_made"="cable"]
    ["location"="underground"]
    ["telecom:medium"="copper"]
    (${minLat},${minLng},${maxLat},${maxLng});

  // Some datasets omit location=underground but still use telecom:medium.
  way
    ["man_made"="cable"]
    ["telecom:medium"="copper"]
    (${minLat},${minLng},${maxLat},${maxLng});
);
out geom tags ${limit ? `limit ${limit}` : ""};
`;

  return q;
}

function geomToPath(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  const path = [];
  for (const pt of geometry) {
    if (!pt || typeof pt !== "object") continue;
    const lat = pt.lat ?? pt[0];
    const lng = pt.lon ?? pt.lng ?? pt[1];
    if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
      path.push({ lat, lng });
    }
  }
  return path.length >= 2 ? path : null;
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

async function main() {
  const { dryRun, limit, scope, bbox, fallbackReclassifyFiber } = parseArgs(process.argv);
  const providerId = providerIdForScope(scope);

  console.log(`Import scope: ${scope}`);
  let finalBbox = bbox;
  if (!finalBbox) {
    finalBbox = await computeDefaultBboxFromUndergroundFiber(scope);
    console.log(`Computed bbox from underground fiber: ${finalBbox.join(",")}`);
  }
  const [minLat, minLng, maxLat, maxLng] = finalBbox;

  const query = buildOverpassQuery(minLat, minLng, maxLat, maxLng, "");
  console.log(`Overpass bbox: ${minLat},${minLng},${maxLat},${maxLng}`);

  if (dryRun) console.log("DRY RUN — no DB writes");

  const data = await fetchOverpass(query);
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  // Overpass `limit` support varies; we enforce limit in JS.
  const ways = elements.filter((e) => e.type === "way");
  console.log(`Overpass returned ways: ${ways.length}`);

  const upserts = [];
  for (const way of ways.slice(0, limit)) {
    const wayId = way.id;
    if (!wayId) continue;

    const tags = way.tags ?? {};
    const path = geomToPath(way.geometry);
    if (!path) continue;

    const sourceId = sourceIdForWay(scope, wayId);
    const name =
      typeof tags.name === "string" && tags.name.trim().length > 0
        ? tags.name.trim()
        : typeof tags.ref === "string" && tags.ref.trim().length > 0
          ? tags.ref.trim()
          : `OSM copper telecom cable ${wayId}`;

    upserts.push({
      where: { sourceId },
      create: {
        sourceId,
        scope,
        type: "CABLE_UNDERGROUND_COPPER",
        providerId,
        name,
        path,
        metadata: {
          dataset: OSM_DATASET,
          sourceClass: OSM_SOURCE_CLASS,
          licenseNote: PROVIDER_LICENSE_NOTE,
          transportMode: "underground",
          underground: true,
          submarine: false,
          cableMaterial: "copper",
          color: "#ffd28a",
          osm: {
            wayId,
            tags,
          },
          importedAt: new Date().toISOString(),
        },
      },
      update: {
        name,
        providerId,
        path,
        metadata: {
          dataset: OSM_DATASET,
          sourceClass: OSM_SOURCE_CLASS,
          licenseNote: PROVIDER_LICENSE_NOTE,
          transportMode: "underground",
          underground: true,
          submarine: false,
          cableMaterial: "copper",
          color: "#ffd28a",
          osm: {
            wayId,
            tags,
          },
          importedAt: new Date().toISOString(),
        },
      },
    });
  }

  console.log(`Prepared ${upserts.length} underground copper cable segment(s).`);

  if (upserts.length === 0 && fallbackReclassifyFiber) {
    console.log("OSM copper segments not found; reclassifying existing underground fiber geometry as copper (fallback).");

    const fiberElements = await prisma.networkElement.findMany({
      where: {
        scope,
        type: "CABLE_UNDERGROUND_FIBER",
        path: { not: null },
      },
      select: { sourceId: true, path: true, name: true, metadata: true },
      take: limit,
    });

    for (const fiber of fiberElements) {
      const fiberSourceId = fiber.sourceId;
      const sourceId = `${fiberSourceId}-reclassified-copper`;
      if (!fiber.path) continue;

      const name =
        typeof fiber.name === "string" && fiber.name.trim().length > 0
          ? `${fiber.name} (copper reclassified)`
          : `Fiber->Copper reclassified (${fiberSourceId})`;

      upserts.push({
        where: { sourceId },
        create: {
          sourceId,
          scope,
          type: "CABLE_UNDERGROUND_COPPER",
          providerId,
          name,
          path: fiber.path,
          metadata: {
            dataset: "fallback-reclassified-from-underground-fiber",
            sourceClass: OSM_SOURCE_CLASS,
            licenseNote: FIBER_FALLBACK_PROVIDER_LICENSE_NOTE,
            transportMode: "underground",
            underground: true,
            submarine: false,
            cableMaterial: "copper",
            color: "#ffd28a",
            fallbackReason: "OSM query for telecom:medium=copper returned zero ways in computed bbox",
            originalFiber: {
              sourceId: fiberSourceId,
            },
            importedAt: new Date().toISOString(),
          },
        },
        update: {
          name,
          path: fiber.path,
          providerId,
          metadata: {
            dataset: "fallback-reclassified-from-underground-fiber",
            sourceClass: OSM_SOURCE_CLASS,
            licenseNote: FIBER_FALLBACK_PROVIDER_LICENSE_NOTE,
            transportMode: "underground",
            underground: true,
            submarine: false,
            cableMaterial: "copper",
            color: "#ffd28a",
            fallbackReason: "OSM query for telecom:medium=copper returned zero ways in computed bbox",
            originalFiber: {
              sourceId: fiberSourceId,
            },
            importedAt: new Date().toISOString(),
          },
        },
      });
    }
  }

  if (dryRun) return;

  await prisma.networkProvider.upsert({
    where: { id: providerId },
    update: {
      name: PROVIDER_NAME,
      sourceUrl: PROVIDER_SOURCE_URL,
      scope,
    },
    create: {
      id: providerId,
      name: PROVIDER_NAME,
      scope,
      sourceUrl: PROVIDER_SOURCE_URL,
    },
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

