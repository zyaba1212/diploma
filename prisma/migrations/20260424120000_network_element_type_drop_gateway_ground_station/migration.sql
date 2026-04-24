-- Remap legacy DB-only enum values to Prisma-known equivalents and drop the
-- two out-of-band values (`GATEWAY`, `GROUND_STATION`) so the Postgres enum
-- matches prisma/schema.prisma exactly.
--
-- Data remap:
--   GATEWAY        -> MESH_RELAY    (mesh gateway nodes: "Шлюз Mesh · …")
--   GROUND_STATION -> BASE_STATION  (satellite ground stations: "Наземная станция · …")

BEGIN;

-- 1) Remap existing rows via text cast (values still belong to the old enum).
UPDATE "NetworkElement"
SET "type" = 'MESH_RELAY'::"NetworkElementType"
WHERE "type"::text = 'GATEWAY';

UPDATE "NetworkElement"
SET "type" = 'BASE_STATION'::"NetworkElementType"
WHERE "type"::text = 'GROUND_STATION';

-- 2) Recreate the enum without the legacy values, in the order declared in
--    prisma/schema.prisma. Postgres does not allow removing enum values in
--    place, so we swap the column type to a fresh enum and drop the old one.
CREATE TYPE "NetworkElementType_new" AS ENUM (
  'CABLE_COPPER',
  'CABLE_FIBER',
  'PROVIDER',
  'SERVER',
  'SWITCH',
  'MULTIPLEXER',
  'DEMULTIPLEXER',
  'REGENERATOR',
  'REGENERATION_POINT',
  'MODEM',
  'CABLE_UNDERGROUND_COPPER',
  'CABLE_UNDERGROUND_FIBER',
  'BASE_STATION',
  'SATELLITE',
  'SATELLITE_RASSVET',
  'EQUIPMENT',
  'MESH_RELAY',
  'SMS_GATEWAY',
  'VSAT_TERMINAL',
  'OFFLINE_QUEUE'
);

ALTER TABLE "NetworkElement"
  ALTER COLUMN "type" TYPE "NetworkElementType_new"
  USING ("type"::text::"NetworkElementType_new");

DROP TYPE "NetworkElementType";
ALTER TYPE "NetworkElementType_new" RENAME TO "NetworkElementType";

COMMIT;
