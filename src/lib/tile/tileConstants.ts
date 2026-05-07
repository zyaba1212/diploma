/**
 * Tile proxy: softer circuit than default (many parallel tile requests per pan).
 */
export const TILE_CIRCUIT_OPTS = {
  failureThreshold: 24,
  windowMs: 120_000,
  cooldownMs: 15_000,
} as const;
