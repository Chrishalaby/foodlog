-- CreateIndex
CREATE INDEX "AiUsage_analysisId_idx" ON "AiUsage"("analysisId");

-- CreateIndex
CREATE INDEX "Analysis_photoId_idx" ON "Analysis"("photoId");

-- CreateIndex
CREATE INDEX "Entry_photoId_idx" ON "Entry"("photoId");

-- CreateIndex
CREATE INDEX "Entry_analysisId_idx" ON "Entry"("analysisId");

-- CreateIndex
CREATE INDEX "Entry_favoriteId_idx" ON "Entry"("favoriteId");

-- CreateIndex
CREATE INDEX "Entry_productId_idx" ON "Entry"("productId");

-- CreateIndex
CREATE INDEX "Favorite_photoId_idx" ON "Favorite"("photoId");
