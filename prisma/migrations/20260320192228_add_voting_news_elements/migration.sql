-- CreateEnum
CREATE TYPE "VoteType" AS ENUM ('FOR', 'AGAINST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NetworkElementType" ADD VALUE 'MESH_RELAY';
ALTER TYPE "NetworkElementType" ADD VALUE 'SMS_GATEWAY';
ALTER TYPE "NetworkElementType" ADD VALUE 'VSAT_TERMINAL';
ALTER TYPE "NetworkElementType" ADD VALUE 'OFFLINE_QUEUE';

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "votingEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "voterPubkey" TEXT NOT NULL,
    "voteType" "VoteType" NOT NULL,
    "signature" TEXT NOT NULL,
    "txSignature" TEXT,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsCache" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vote_proposalId_idx" ON "Vote"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_proposalId_voterPubkey_key" ON "Vote"("proposalId", "voterPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "NewsCache_url_key" ON "NewsCache"("url");

-- CreateIndex
CREATE INDEX "NewsCache_publishedAt_idx" ON "NewsCache"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsCache_source_idx" ON "NewsCache"("source");

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
