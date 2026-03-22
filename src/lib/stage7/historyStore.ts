import type { PrismaClient } from '@prisma/client';

export type HistoryEntryRow = {
  id: string;
  proposalId: string;
  actionId: string;
  appliedByPubkey: string | null;
  appliedAt: Date;
  diff: unknown;
};

export async function ensureHistoryEntryTable(prisma: PrismaClient | any) {
  // Create history table without Prisma migration (Stage 7 schema may be added later).
  // Prisma sometimes disallows executing multiple SQL statements in a single prepared query.
  // Keep them in separate calls to avoid: "cannot insert multiple commands into a prepared statement".
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HistoryEntry" (
      id TEXT PRIMARY KEY,
      "proposalId" TEXT NOT NULL,
      "actionId" TEXT NOT NULL,
      "appliedByPubkey" TEXT NULL,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      diff JSONB NOT NULL
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "HistoryEntry_proposalId_appliedAt_idx"
      ON "HistoryEntry" ("proposalId", "appliedAt" DESC);
  `);
}

export async function insertHistoryEntry(
  prisma: PrismaClient | any,
  input: {
    id: string;
    proposalId: string;
    actionId: string;
    appliedByPubkey?: string | null;
    diff: unknown;
  },
) {
  const diffJson = JSON.stringify(input.diff ?? {});
  const appliedAt = new Date();
  await prisma.$executeRaw`
    INSERT INTO "HistoryEntry"
      (id, "proposalId", "actionId", "appliedByPubkey", "appliedAt", diff)
    VALUES
      (${input.id}, ${input.proposalId}, ${input.actionId}, ${input.appliedByPubkey ?? null}, ${appliedAt}, CAST(${diffJson} AS jsonb))
  `;
}

export async function getLatestHistoryEntry(
  prisma: PrismaClient | any,
  proposalId: string,
): Promise<HistoryEntryRow | null> {
  await ensureHistoryEntryTable(prisma);

  const rows = (await prisma.$queryRaw`
    SELECT
      id,
      "proposalId" AS "proposalId",
      "actionId" AS "actionId",
      "appliedByPubkey" AS "appliedByPubkey",
      "appliedAt" AS "appliedAt",
      diff AS diff
    FROM "HistoryEntry"
    WHERE "proposalId" = ${proposalId}
    ORDER BY "appliedAt" DESC
    LIMIT 1;
  `) as Array<{
    id: string;
    proposalId: string;
    actionId: string;
    appliedByPubkey: string | null;
    appliedAt: Date;
    diff: unknown;
  }>;

  return rows[0] ?? null;
}

export async function listHistoryEntries(
  prisma: PrismaClient | any,
  proposalId: string,
  limit: number,
): Promise<Array<Pick<HistoryEntryRow, 'id' | 'actionId' | 'appliedAt' | 'appliedByPubkey'>>> {
  await ensureHistoryEntryTable(prisma);

  const rows = (await prisma.$queryRaw`
      SELECT
        id,
        "actionId" AS "actionId",
        "appliedAt" AS "appliedAt",
        "appliedByPubkey" AS "appliedByPubkey"
      FROM "HistoryEntry"
      WHERE "proposalId" = ${proposalId}
      ORDER BY "appliedAt" DESC
      LIMIT ${Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50}
    `) as Array<{
    id: string;
    actionId: string;
    appliedAt: Date;
    appliedByPubkey: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    actionId: r.actionId,
    appliedAt: r.appliedAt,
    appliedByPubkey: r.appliedByPubkey,
  }));
}

export async function deleteHistoryEntry(prisma: PrismaClient | any, id: string) {
  await ensureHistoryEntryTable(prisma);
  await prisma.$executeRaw`DELETE FROM "HistoryEntry" WHERE id = ${id}`;
}

