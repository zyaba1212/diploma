-- Stage 13 — admin panel baseline
-- Extends StaffRole enum, adds ban/cancel/rejection audit fields,
-- introduces AuditLog and ProposalFeedback models, adds StaffSession.pubkey.

-- AlterEnum StaffRole: add MODERATOR (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'StaffRole'
      AND e.enumlabel = 'MODERATOR'
  ) THEN
    ALTER TYPE "StaffRole" ADD VALUE 'MODERATOR';
  END IF;
END
$$;

-- CreateEnum AuditActorType (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditActorType') THEN
    CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'SYSTEM');
  END IF;
END
$$;

-- AlterTable: User — ban fields
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "bannedReason" TEXT;
CREATE INDEX "User_bannedAt_idx" ON "User"("bannedAt");

-- AlterTable: StaffSession — pubkey and indexes
ALTER TABLE "StaffSession" ADD COLUMN "pubkey" TEXT;
CREATE INDEX "StaffSession_role_idx" ON "StaffSession"("role");
CREATE INDEX "StaffSession_expiresAt_idx" ON "StaffSession"("expiresAt");

-- AlterTable: Proposal — admin cancel & rejection audit
ALTER TABLE "Proposal" ADD COLUMN "cancelledByStaffSessionId" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_cancelledByStaffSessionId_fkey"
  FOREIGN KEY ("cancelledByStaffSessionId") REFERENCES "StaffSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: ModerationDecision — free-text comment
ALTER TABLE "ModerationDecision" ADD COLUMN "comment" TEXT;

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "staffSessionId" TEXT,
    "actorPubkey" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");
CREATE INDEX "AuditLog_action_at_idx" ON "AuditLog"("action", "at");
CREATE INDEX "AuditLog_staffSessionId_idx" ON "AuditLog"("staffSessionId");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "AuditLog_actorPubkey_at_idx" ON "AuditLog"("actorPubkey", "at");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_staffSessionId_fkey"
  FOREIGN KEY ("staffSessionId") REFERENCES "StaffSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: ProposalFeedback
CREATE TABLE "ProposalFeedback" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "moderatorPubkey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProposalFeedback_proposalId_createdAt_idx" ON "ProposalFeedback"("proposalId", "createdAt");

ALTER TABLE "ProposalFeedback" ADD CONSTRAINT "ProposalFeedback_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
