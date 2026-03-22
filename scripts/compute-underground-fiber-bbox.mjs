import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const elements = await prisma.networkElement.findMany({
    where: {
      scope: "GLOBAL",
      type: "CABLE_UNDERGROUND_FIBER",
      path: { not: null },
    },
    select: { path: true },
  });

  if (elements.length === 0) {
    console.log("No GLOBAL underground fiber elements found");
    return;
  }

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

  if (lats.length === 0 || lngs.length === 0) {
    console.log("Found elements but no path coordinates to compute bbox");
    return;
  }

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Add a small padding so queries include cable segments endpoints.
  const pad = 0.05;
  console.log(
    JSON.stringify(
      { count: elements.length, minLat, maxLat, minLng, maxLng, bboxPadded: [minLat - pad, minLng - pad, maxLat + pad, maxLng + pad] },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

