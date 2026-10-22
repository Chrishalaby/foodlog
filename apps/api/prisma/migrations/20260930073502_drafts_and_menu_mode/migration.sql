-- AlterEnum
ALTER TYPE "AnalysisMode" ADD VALUE 'menu';

-- CreateTable
CREATE TABLE "Draft" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mode" "AnalysisMode" NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "mealType" "MealType",
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "localDate" VARCHAR(10) NOT NULL,
    "items" JSONB,
    "analysisId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPhoto" (
    "draftId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'food',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DraftPhoto_pkey" PRIMARY KEY ("draftId","photoId")
);

-- CreateIndex
CREATE INDEX "Draft_userId_updatedAt_idx" ON "Draft"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Draft_analysisId_idx" ON "Draft"("analysisId");

-- CreateIndex
CREATE INDEX "DraftPhoto_photoId_idx" ON "DraftPhoto"("photoId");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPhoto" ADD CONSTRAINT "DraftPhoto_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPhoto" ADD CONSTRAINT "DraftPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
