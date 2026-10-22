-- CreateTable
CREATE TABLE "EntryPhoto" (
    "entryId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'food',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EntryPhoto_pkey" PRIMARY KEY ("entryId","photoId")
);

-- CreateIndex
CREATE INDEX "EntryPhoto_photoId_idx" ON "EntryPhoto"("photoId");

-- AddForeignKey
ALTER TABLE "EntryPhoto" ADD CONSTRAINT "EntryPhoto_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryPhoto" ADD CONSTRAINT "EntryPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "EntryPhoto" ("entryId", "photoId", "role", "position")
SELECT e."id", ap."photoId", ap."role", ap."position"
FROM "Entry" e
JOIN "AnalysisPhoto" ap ON ap."analysisId" = e."analysisId"
ON CONFLICT DO NOTHING;

INSERT INTO "EntryPhoto" ("entryId", "photoId", "role", "position")
SELECT e."id",
       e."photoId",
       CASE WHEN e."source" = 'nutrition_label' THEN 'label' ELSE 'food' END,
       COALESCE((SELECT MAX(x."position") + 1 FROM "EntryPhoto" x WHERE x."entryId" = e."id"), 0)
FROM "Entry" e
WHERE e."photoId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "EntryPhoto" x WHERE x."entryId" = e."id" AND x."photoId" = e."photoId")
ON CONFLICT DO NOTHING;
