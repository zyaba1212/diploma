-- Add server-level source URL for network elements
ALTER TABLE "NetworkElement"
ADD COLUMN "sourceUrl" TEXT;
