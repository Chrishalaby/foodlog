ALTER TABLE "User" ADD COLUMN     "demoExpiresAt" TIMESTAMPTZ(3);

CREATE INDEX "User_demoExpiresAt_idx" ON "User"("demoExpiresAt");
