-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "bodyFatPct" DOUBLE PRECISION,
ADD COLUMN     "onboardedAt" TIMESTAMPTZ(3),
ADD COLUMN     "tdeeOverride" INTEGER;

-- CreateTable
CREATE TABLE "WeightLog" (
    "userId" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "bodyFatPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WeightLog_pkey" PRIMARY KEY ("userId","date")
);

-- AddForeignKey
ALTER TABLE "WeightLog" ADD CONSTRAINT "WeightLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
