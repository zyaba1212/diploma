import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const scope = (process.argv[2] ?? "GLOBAL").toUpperCase();

const types = [
  "CABLE_UNDERGROUND_COPPER",
  "CABLE_UNDERGROUND_FIBER",
  "PROVIDER",
  "SERVER",
  "SATELLITE",
  "BASE_STATION",
  "SWITCH",
  "MULTIPLEXER",
  "DEMULTIPLEXER",
  "REGENERATOR",
  "MODEM",
];

async function main() {
  const rows = await Promise.all(
    types.map(async (type) => {
      const count = await prisma.networkElement.count({ where: { scope, type } });
      return { type, count };
    }),
  );

  // Keep output stable for copy/paste into DEVELOPMENT_JOURNAL / review.
  console.log(JSON.stringify({ scope, rows }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

