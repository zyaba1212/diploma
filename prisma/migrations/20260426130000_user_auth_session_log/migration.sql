-- CreateTable
CREATE TABLE "UserAuthSession" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAuthSession_pubkey_createdAt_idx" ON "UserAuthSession"("pubkey", "createdAt");

-- CreateIndex
CREATE INDEX "UserAuthSession_createdAt_idx" ON "UserAuthSession"("createdAt");
