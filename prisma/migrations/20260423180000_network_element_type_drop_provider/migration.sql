-- Remove NetworkElementType value PROVIDER: delete elements and recreate enum
-- (Postgres cannot drop enum values in place). NetworkProvider table unchanged.

BEGIN;

DELETE FROM "NetworkElement" WHERE "type"::text = 'PROVIDER';

CREATE TYPE "NetworkElementType_new" AS ENUM (
  'CABLE_COPPER',
  'CABLE_FIBER',
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
