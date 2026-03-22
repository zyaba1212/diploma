# DBPrismaAgent migration: underground/node enum types

## Changes

- Extend PostgreSQL enum `NetworkElementType` with:
  - Node types: `PROVIDER`, `SERVER`, `SWITCH`, `MULTIPLEXER`, `DEMULTIPLEXER`, `REGENERATOR`, `MODEM`
  - Underground cable types: `CABLE_UNDERGROUND_COPPER`, `CABLE_UNDERGROUND_FIBER`
- Add composite index:
  - `NetworkElement(scope, type)` for filtering by both predicates.

## Notes

- Uses `pg_enum` guards to make enum addition idempotent.
- Frontend/rendering/API contracts are unchanged; this is DB + typing baseline.

