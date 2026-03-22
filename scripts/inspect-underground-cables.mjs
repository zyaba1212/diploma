import { readFile } from "node:fs/promises";

const DEFAULT_GEO_URL =
  "https://data.gov.au/geoserver/fibre-optic-cable/wfs?request=GetFeature&typeName=ckan_fa5452e4_7713_4c15_b647_ba0191a8c25c&outputFormat=json&maxFeatures=2000";

function idForFeature(feature) {
  const fid = typeof feature?.id === "string" ? feature.id : null;
  if (fid) return fid;
  const pid = typeof feature?.properties?.id === "string" ? feature.properties.id : null;
  if (pid) return pid;
  const fallback = feature?.properties?.feature_id;
  return typeof fallback === "string" ? fallback : "unknown";
}

function pickCableRelatedProps(props) {
  if (!props || typeof props !== "object") return {};
  const keys = Object.keys(props);
  const wanted = keys.filter((k) => /cable|material|fiber|optic|copper|conductor|duct|metal|wire/i.test(k));
  const out = {};
  for (const k of wanted.slice(0, 40)) out[k] = props[k];
  return out;
}

function summarizeProps(props) {
  if (!props || typeof props !== "object") return { keys: [], sample: {} };
  const keys = Object.keys(props);
  const sample = {};
  for (const k of keys.slice(0, 30)) sample[k] = props[k];
  return { keys, sample };
}

async function main() {
  const url = process.env.UNDERGROUND_CABLE_GEO_URL || DEFAULT_GEO_URL;
  const limit = Number(process.env.LIMIT ?? "10");
  const filePath = process.argv.includes("--file") ? process.argv[process.argv.indexOf("--file") + 1] : null;

  let geo;
  if (filePath) {
    const raw = await readFile(filePath, "utf8");
    geo = JSON.parse(raw);
  } else {
    const res = await fetch(url, { headers: { accept: "application/geo+json, application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    geo = await res.json();
  }

  if (!geo || geo.type !== "FeatureCollection" || !Array.isArray(geo.features)) {
    throw new Error("Expected GeoJSON FeatureCollection");
  }

  console.log(`Total features in GeoJSON: ${geo.features.length}`);

  let printed = 0;
  for (const f of geo.features) {
    if (printed >= limit) break;
    if (!f || f.type !== "Feature") continue;
    const props = f.properties ?? {};

    const interesting = pickCableRelatedProps(props);
    if (Object.keys(interesting).length > 0) {
      console.log(JSON.stringify({ id: idForFeature(f), interesting }, null, 2));
    } else {
      const { keys, sample } = summarizeProps(props);
      console.log(
        JSON.stringify(
          { id: idForFeature(f), interesting: {}, propKeyCount: keys.length, propKeysSample: keys.slice(0, 40), propSample: sample },
          null,
          2,
        ),
      );
    }
    printed++;
  }

  console.log(`Printed ${printed} feature(s) with cable-related props`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

