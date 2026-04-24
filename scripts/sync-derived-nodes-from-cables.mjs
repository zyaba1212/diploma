/**
 * Заполняет “узловые” типы NetworkElement (SERVER/SWITCH/...)
 * на основе геометрии уже импортированных кабелей.
 *
 * Это НЕ прямой импорт конкретного оборудования (OSM/TLE-данные для каждого типа
 * могут отсутствовать в открытых наборах), поэтому позиции считаются
 * *инференс-позициями* из `NetworkElement.path`:
 * - берем набор точек из path кабелей соответствующего провайдера
 * - раскладываем типы узлов по фиксированным индексам (first/middle/last/quarter*...)
 *
 * Тем не менее, координаты берутся из реальной геометрии кабельного датасета,
 * а не из “пустых заглушек”.
 */
import { PrismaClient } from "@prisma/client";
import { resolveServerSourceUrl } from "./lib/resolve-server-source-url.mjs";

const prisma = new PrismaClient();

const NODE_TYPES = ["SERVER", "SWITCH", "MULTIPLEXER", "DEMULTIPLEXER", "REGENERATOR", "MODEM"];
const CABLE_TYPES = ["CABLE_UNDERGROUND_FIBER", "CABLE_UNDERGROUND_COPPER"];

function parseArgs(argv) {
  let dryRun = false;
  let scope = "GLOBAL";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--scope") {
      scope = String(argv[++i] ?? "").toUpperCase();
      if (scope !== "GLOBAL" && scope !== "LOCAL") throw new Error("--scope must be GLOBAL or LOCAL");
    }
  }
  return { dryRun, scope };
}

function sourceIdForNode(scope, providerId, type) {
  return `derived-cables-${scope}-${providerId}-${type}`;
}

function pickPoint(points, idx) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const i = Math.max(0, Math.min(points.length - 1, idx));
  const p = points[i];
  if (!p || typeof p !== "object") return null;
  if (typeof p.lat !== "number" || !Number.isFinite(p.lat) || typeof p.lng !== "number" || !Number.isFinite(p.lng)) return null;
  return p;
}

async function main() {
  const { dryRun, scope } = parseArgs(process.argv);
  console.log(`Import scope: ${scope}`);
  if (dryRun) console.log("DRY RUN — no DB writes");

  const providerIdRows = await prisma.networkElement.findMany({
    where: {
      scope,
      providerId: { not: null },
      type: { in: CABLE_TYPES },
    },
    select: { providerId: true },
    distinct: ["providerId"],
  });

  const providerIds = providerIdRows.map((r) => r.providerId).filter((v) => typeof v === "string");

  console.log(`Found cable providers in scope: ${providerIds.length}`);
  if (providerIds.length === 0) return;

  const upserts = [];

  const providers = await prisma.networkProvider.findMany({
    where: { id: { in: providerIds } },
    select: { id: true, name: true },
  });
  const providerById = new Map(providers.map((p) => [p.id, p.name]));

  for (const providerId of providerIds) {
    // Flatten path points from cable elements for this provider.
    const cables = await prisma.networkElement.findMany({
      where: {
        scope,
        providerId,
        type: { in: CABLE_TYPES },
      },
      select: { path: true, sourceId: true },
      take: 1000,
    });

    const points = [];
    const cableSourceIds = [];
    for (const c of cables) {
      if (typeof c.sourceId === "string") cableSourceIds.push(c.sourceId);
      const path = c.path;
      if (!Array.isArray(path)) continue;
      for (const p of path) {
        if (!p || typeof p !== "object") continue;
        const lat = p.lat;
        const lng = p.lng;
        if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
          points.push({ lat, lng });
        }
      }
    }

    if (points.length < 2) continue;

    // Keep point list manageable.
    const MAX_POINTS = 5000;
    let sampled = points;
    if (points.length > MAX_POINTS) {
      const step = Math.ceil(points.length / MAX_POINTS);
      sampled = [];
      for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
    }

    const namePrefix = providerById.get(providerId) ?? providerId;
    const len = sampled.length;

    const positionByType = {
      SERVER: pickPoint(sampled, Math.floor(len / 3)),
      SWITCH: pickPoint(sampled, Math.floor((len * 2) / 3)),
      MULTIPLEXER: pickPoint(sampled, Math.floor(len / 4)),
      DEMULTIPLEXER: pickPoint(sampled, Math.floor((len * 3) / 4)),
      REGENERATOR: pickPoint(sampled, len - 1),
      MODEM: pickPoint(sampled, Math.max(0, len - 2)),
    };

    for (const type of NODE_TYPES) {
      const pos = positionByType[type];
      if (!pos) continue;
      const sourceId = sourceIdForNode(scope, providerId, type);
      const nodeName = `${namePrefix} — ${type}`;
      const sourceUrl =
        type === "SERVER"
          ? resolveServerSourceUrl({
              name: nodeName,
              operator: namePrefix,
              metadata: {
                dataset: "derived-from-cables",
                operator: namePrefix,
              },
            })
          : null;

      const createData = {
        sourceId,
        scope,
        type,
        providerId,
        name: nodeName,
        lat: pos.lat,
        lng: pos.lng,
        altitude: null,
        metadata: {
          dataset: "derived-from-cables",
          licenseNote: "inferred positions derived from licensed cable geometries already imported into this DB",
          derivedFromProviderId: providerId,
          derivedFromCableSourceIds: cableSourceIds.slice(0, 20),
          derivedIndex: null,
          importedAt: new Date().toISOString(),
        },
      };
      const updateData = {
        name: nodeName,
        providerId,
        lat: pos.lat,
        lng: pos.lng,
        metadata: {
          dataset: "derived-from-cables",
          licenseNote: "inferred positions derived from licensed cable geometries already imported into this DB",
          derivedFromProviderId: providerId,
          derivedFromCableSourceIds: cableSourceIds.slice(0, 20),
          importedAt: new Date().toISOString(),
        },
      };
      if (type === "SERVER" && sourceUrl) {
        createData.sourceUrl = sourceUrl;
        updateData.sourceUrl = sourceUrl;
      }

      upserts.push({
        where: { sourceId },
        create: createData,
        update: updateData,
      });
    }
  }

  console.log(`Prepared ${upserts.length} derived node(s).`);
  if (dryRun) return;

  const BATCH = 25;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const chunk = upserts.slice(i, i + BATCH);
    await prisma.$transaction(chunk.map((args) => prisma.networkElement.upsert(args)));
  }

  console.log("Derived node import finished OK.");
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

