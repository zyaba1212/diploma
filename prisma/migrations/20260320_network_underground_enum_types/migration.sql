-- DBPrismaAgent: db-underground-types
-- Expand NetworkElementType enum with node + underground cable types.

BEGIN;

-- Add new enum values (idempotent guard via pg_enum).
DO $$
BEGIN
  -- Node types
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'PROVIDER'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'PROVIDER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'SERVER'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'SERVER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'SWITCH'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'SWITCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'MULTIPLEXER'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'MULTIPLEXER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'DEMULTIPLEXER'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'DEMULTIPLEXER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'REGENERATOR'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'REGENERATOR';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'MODEM'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'MODEM';
  END IF;

  -- Underground / terrestrial cables
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'CABLE_UNDERGROUND_COPPER'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'CABLE_UNDERGROUND_COPPER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'CABLE_UNDERGROUND_FIBER'
  ) THEN ALTER TYPE "NetworkElementType" ADD VALUE 'CABLE_UNDERGROUND_FIBER';
  END IF;
END
$$;

-- Minimal index for queries filtering by scope + type.
CREATE INDEX IF NOT EXISTS "NetworkElement_scope_type_idx"
  ON "NetworkElement" ("scope", "type");

COMMIT;

