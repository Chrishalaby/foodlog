-- CreateTable
CREATE TABLE "AnalysisPhoto" (
    "analysisId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'food',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalysisPhoto_pkey" PRIMARY KEY ("analysisId","photoId")
);

-- CreateIndex
CREATE INDEX "AnalysisPhoto_photoId_idx" ON "AnalysisPhoto"("photoId");

-- AddForeignKey
ALTER TABLE "AnalysisPhoto" ADD CONSTRAINT "AnalysisPhoto_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisPhoto" ADD CONSTRAINT "AnalysisPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
