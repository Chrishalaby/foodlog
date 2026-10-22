-- CreateEnum
CREATE TYPE "FluidKind" AS ENUM ('water', 'coffee', 'tea', 'other');

-- AlterTable
ALTER TABLE "EntryItem" ADD COLUMN     "fluidMl" DOUBLE PRECISION,
ADD COLUMN     "micros" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "microsPer100" JSONB;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "dayStartHour" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "fluidTargetMl" INTEGER,
ADD COLUMN     "foodMergeDecisions" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "FluidLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "localDate" VARCHAR(10) NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "ml" DOUBLE PRECISION NOT NULL,
    "kind" "FluidKind" NOT NULL DEFAULT 'water',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FluidLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FluidLog_userId_localDate_idx" ON "FluidLog"("userId", "localDate");

-- AddForeignKey
ALTER TABLE "FluidLog" ADD CONSTRAINT "FluidLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
