import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Same idea as Next: .env then .env.local (local overrides). */
function loadEnvFromFile(fileName, overrideExisting) {
  const full = path.join(projectRoot, fileName);
  if (!existsSync(full)) return;
  const text = readFileSync(full, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (overrideExisting || process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFromFile(".env", false);
loadEnvFromFile(".env.local", true);

const prisma = new PrismaClient();

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true";
}

function envInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function assertScope(scope) {
  const s = String(scope ?? "").toUpperCase();
  if (s !== "GLOBAL" && s !== "LOCAL") throw new Error(`Invalid SEED_SCOPE: ${scope}`);
  return s;
}

function runNodeScript(scriptRelPath, args) {
  const scriptAbsPath = path.join(process.cwd(), scriptRelPath);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptAbsPath, ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script failed (${code}): ${scriptRelPath}`));
    });
  });
}

async function upsertDemoSatellite() {
  const provider = await prisma.networkProvider.upsert({
    where: { id: "demo-provider" },
    update: {},
    create: {
      id: "demo-provider",
      name: "DemoProvider",
      scope: "GLOBAL",
      sourceUrl: "https://example.com",
    },
  });

  await prisma.networkElement.upsert({
    where: { sourceId: "demo-sat-1" },
    update: { providerId: provider.id, scope: "GLOBAL" },
    create: {
      scope: "GLOBAL",
      type: "SATELLITE",
      providerId: provider.id,
      name: "Demo Sat",
      sourceId: "demo-sat-1",
      lat: 0,
      lng: 0,
      altitude: 550,
      metadata: { note: "seed (satellite placeholder)" },
    },
  });
}

async function main() {
  const scope = assertScope(process.env.SEED_SCOPE ?? "GLOBAL");

  // Limits for pulling “enough” features so the map layers are not empty.
  const undergroundFiberLimit = envInt("SEED_UNDERGROUND_FIBER_LIMIT", 2000);
  const undergroundCopperLimit = envInt("SEED_UNDERGROUND_COPPER_LIMIT", 2000);
  const baseStationsLimit = envInt("SEED_BASE_STATIONS_LIMIT", 2000);

  const submarineCableLimit = envInt("SEED_SUBMARINE_CABLE_LIMIT", 500);
  const satelliteLimit = envInt("SEED_SATELLITE_LIMIT", 30);

  const fallbackReclassifyFiber = envBool("SEED_COPPER_FALLBACK_RECLASSIFY_FIBER", true);
  const runDerivedNodes = envBool("SEED_DERIVED_NODES", true);
  const importSubmarineCables = envBool("SEED_IMPORT_SUBMARINE_CABLES", true);
  const importUndergroundCables = envBool("SEED_IMPORT_UNDERGROUND_CABLES", true);
  const importBaseStations = envBool("SEED_IMPORT_BASE_STATIONS", true);
  const importSatellites = envBool("SEED_IMPORT_SATELLITES", true);

  // Keep existing demo satellite so UI still has at least one SATELLITE element.
  const seedDemoSatellite = envBool("SEED_DEMO_SATELLITE", true);
  if (seedDemoSatellite) {
    await upsertDemoSatellite();
  }

  // Close Prisma connection before running network-heavy import scripts.
  await prisma.$disconnect();

  if (importSubmarineCables) {
    await runNodeScript("scripts/sync-submarine-cables.mjs", ["--limit", String(submarineCableLimit)]);
  }

  if (importUndergroundCables) {
    await runNodeScript("scripts/sync-underground-cables.mjs", ["--scope", scope, "--limit", String(undergroundFiberLimit)]);
    const copperArgs = ["--scope", scope, "--limit", String(undergroundCopperLimit)];
    if (fallbackReclassifyFiber) copperArgs.push("--fallback-reclassify-fiber");
    await runNodeScript("scripts/sync-underground-copper-cables-osm.mjs", copperArgs);
  }

  if (importBaseStations) {
    await runNodeScript("scripts/sync-base-stations-osm.mjs", ["--scope", scope, "--limit", String(baseStationsLimit)]);
  }

  if (runDerivedNodes) {
    await runNodeScript("scripts/sync-derived-nodes-from-cables.mjs", ["--scope", scope]);
  }

  if (importSatellites) {
    await runNodeScript("scripts/sync-satellites-tle-celestrak.mjs", ["--scope", scope, "--limit", String(satelliteLimit)]);
  }

  // Global backbone terrestrial cables (representative routes).
  const importGlobalBackbone = envBool("SEED_IMPORT_GLOBAL_BACKBONE", true);
  if (importGlobalBackbone) {
    await runNodeScript("scripts/sync-global-backbone-cables.mjs", []);
  }

  // Major data centers and Internet Exchange points.
  const importDatacenters = envBool("SEED_IMPORT_DATACENTERS", true);
  if (importDatacenters) {
    await runNodeScript("scripts/sync-major-datacenters.mjs", []);
  }

  /** Референсное предложение: устойчивая сеть по РБ (mesh, SMS, офлайн-очереди, VSAT, кабели). */
  if (envBool("SEED_BELARUS_PROPOSAL", true)) {
    await runNodeScript("scripts/seed-belarus-proposal.mjs", []);
  }

}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

