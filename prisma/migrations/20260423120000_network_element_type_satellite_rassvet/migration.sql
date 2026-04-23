-- NetworkElementType: value may already exist if DB was altered out-of-band.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'SATELLITE_RASSVET'
  ) THEN
    ALTER TYPE "NetworkElementType" ADD VALUE 'SATELLITE_RASSVET';
  END IF;
END
$migration$;
