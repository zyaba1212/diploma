-- NetworkElementType: точка регенерации на трассе (импорт / legacy-имя рядом с REGENERATOR).
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'NetworkElementType'
      AND e.enumlabel = 'REGENERATION_POINT'
  ) THEN
    ALTER TYPE "NetworkElementType" ADD VALUE 'REGENERATION_POINT';
  END IF;
END
$migration$;
