-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

-- Index for list ordering: pinned first, then by date
CREATE INDEX "Proposal_pinned_createdAt_idx" ON "Proposal"("pinned" DESC, "createdAt" DESC);
