-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN');

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'ADMIN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeratorGrant" (
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByStaffSessionId" TEXT,

    CONSTRAINT "ModeratorGrant_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ModeratorGrant_grantedAt_idx" ON "ModeratorGrant"("grantedAt");

-- AddForeignKey
ALTER TABLE "ModeratorGrant" ADD CONSTRAINT "ModeratorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModeratorGrant" ADD CONSTRAINT "ModeratorGrant_grantedByStaffSessionId_fkey" FOREIGN KEY ("grantedByStaffSessionId") REFERENCES "StaffSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
