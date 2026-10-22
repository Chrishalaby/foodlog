-- AlterTable
ALTER TABLE "EntryItem" ADD COLUMN     "productId" UUID;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "unitGrams" DOUBLE PRECISION,
ADD COLUMN     "unitName" TEXT,
ALTER COLUMN "barcode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "dismissedFoodMerges" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "EntryItem_productId_idx" ON "EntryItem"("productId");

-- CreateIndex
CREATE INDEX "Product_userId_useCount_idx" ON "Product"("userId", "useCount");

-- AddForeignKey
ALTER TABLE "EntryItem" ADD CONSTRAINT "EntryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "EntryItem" AS i
SET "productId" = e."productId"
FROM "Entry" AS e
WHERE i."entryId" = e."id"
  AND e."productId" IS NOT NULL
  AND i."productId" IS NULL
  AND (SELECT count(*) FROM "EntryItem" AS x WHERE x."entryId" = e."id") = 1;
