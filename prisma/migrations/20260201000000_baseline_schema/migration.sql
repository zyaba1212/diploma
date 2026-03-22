-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Scope" AS ENUM ('GLOBAL', 'LOCAL');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChangeActionType" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "NetworkElementType" AS ENUM ('CABLE_COPPER', 'CABLE_FIBER', 'BASE_STATION', 'SATELLITE', 'EQUIPMENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkElement" (
    "id" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "type" "NetworkElementType" NOT NULL,
    "providerId" TEXT,
    "name" TEXT,
    "sourceId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "path" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "authorPubkey" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "contentHash" TEXT,
    "signature" TEXT,
    "onChainTxSignature" TEXT,
    "onChainSubmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeAction" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "actionType" "ChangeActionType" NOT NULL,
    "targetElementId" TEXT,
    "elementPayload" JSONB NOT NULL,
    "reversePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryEntry" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "appliedByPubkey" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "diff" JSONB NOT NULL,

    CONSTRAINT "HistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationDecision" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "moderatorPubkey" TEXT NOT NULL,
    "fromStatus" "ProposalStatus" NOT NULL,
    "toStatus" "ProposalStatus" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionSignature" TEXT,

    CONSTRAINT "ModerationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_pubkey_key" ON "User"("pubkey");

-- CreateIndex
CREATE INDEX "NetworkProvider_scope_idx" ON "NetworkProvider"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkElement_sourceId_key" ON "NetworkElement"("sourceId");

-- CreateIndex
CREATE INDEX "NetworkElement_scope_idx" ON "NetworkElement"("scope");

-- CreateIndex
CREATE INDEX "NetworkElement_scope_lat_lng_idx" ON "NetworkElement"("scope", "lat", "lng");

-- CreateIndex
CREATE INDEX "NetworkElement_type_idx" ON "NetworkElement"("type");

-- CreateIndex
CREATE INDEX "NetworkElement_lat_lng_idx" ON "NetworkElement"("lat", "lng");

-- CreateIndex
CREATE INDEX "Proposal_authorPubkey_status_idx" ON "Proposal"("authorPubkey", "status");

-- CreateIndex
CREATE INDEX "Proposal_status_createdAt_idx" ON "Proposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_authorPubkey_status_createdAt_idx" ON "Proposal"("authorPubkey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_onChainTxSignature_idx" ON "Proposal"("onChainTxSignature");

-- CreateIndex
CREATE INDEX "Proposal_onChainSubmittedAt_idx" ON "Proposal"("onChainSubmittedAt");

-- CreateIndex
CREATE INDEX "ChangeAction_proposalId_idx" ON "ChangeAction"("proposalId");

-- CreateIndex
CREATE INDEX "ChangeAction_targetElementId_idx" ON "ChangeAction"("targetElementId");

-- CreateIndex
CREATE INDEX "HistoryEntry_proposalId_idx" ON "HistoryEntry"("proposalId");

-- CreateIndex
CREATE INDEX "HistoryEntry_actionId_idx" ON "HistoryEntry"("actionId");

-- CreateIndex
CREATE INDEX "HistoryEntry_appliedAt_idx" ON "HistoryEntry"("appliedAt");

-- CreateIndex
CREATE INDEX "HistoryEntry_proposalId_appliedAt_idx" ON "HistoryEntry"("proposalId", "appliedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationDecision_proposalId_key" ON "ModerationDecision"("proposalId");

-- CreateIndex
CREATE INDEX "ModerationDecision_moderatorPubkey_decidedAt_idx" ON "ModerationDecision"("moderatorPubkey", "decidedAt");

-- CreateIndex
CREATE INDEX "ModerationDecision_toStatus_decidedAt_idx" ON "ModerationDecision"("toStatus", "decidedAt");

-- AddForeignKey
ALTER TABLE "NetworkElement" ADD CONSTRAINT "NetworkElement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "NetworkProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_targetElementId_fkey" FOREIGN KEY ("targetElementId") REFERENCES "NetworkElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationDecision" ADD CONSTRAINT "ModerationDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HistoryEntry diff.kind guard (ex Stage 8 hardening)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'HistoryEntry_diff_kind_check'
  ) THEN
    ALTER TABLE "HistoryEntry"
    ADD CONSTRAINT "HistoryEntry_diff_kind_check"
    CHECK (
      jsonb_typeof(diff) = 'object'
      AND (diff->>'kind') IN ('CREATE', 'UPDATE', 'DELETE')
    );
  END IF;
END
$$;

