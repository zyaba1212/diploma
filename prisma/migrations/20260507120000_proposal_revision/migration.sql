-- ProposalRevision: git-like history of sandbox graph commits per proposal

CREATE TABLE "ProposalRevision" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "parentRevisionId" TEXT,
    "authorPubkey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "diffSummary" JSONB,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProposalRevision_proposalId_createdAt_idx" ON "ProposalRevision"("proposalId", "createdAt");
CREATE INDEX "ProposalRevision_parentRevisionId_idx" ON "ProposalRevision"("parentRevisionId");

ALTER TABLE "ProposalRevision" ADD CONSTRAINT "ProposalRevision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalRevision" ADD CONSTRAINT "ProposalRevision_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "ProposalRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Proposal" ADD COLUMN "headRevisionId" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "forkedFromProposalId" TEXT;

CREATE UNIQUE INDEX "Proposal_headRevisionId_key" ON "Proposal"("headRevisionId");
CREATE INDEX "Proposal_forkedFromProposalId_idx" ON "Proposal"("forkedFromProposalId");

ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_headRevisionId_fkey" FOREIGN KEY ("headRevisionId") REFERENCES "ProposalRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_forkedFromProposalId_fkey" FOREIGN KEY ("forkedFromProposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
