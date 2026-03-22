-- AlterTable: Auth / Profile — username на сайте
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "usernameSetAt" TIMESTAMP(3);

-- Unique username (Postgres: несколько NULL допустимо)
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
