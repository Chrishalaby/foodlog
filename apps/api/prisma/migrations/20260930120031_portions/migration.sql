-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "portionCount" DOUBLE PRECISION,
ADD COLUMN     "portionUnit" TEXT,
ADD COLUMN     "portionUnitPlural" TEXT;

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "portionCount" DOUBLE PRECISION,
ADD COLUMN     "portionUnit" TEXT,
ADD COLUMN     "portionUnitPlural" TEXT;

-- AlterTable
ALTER TABLE "EntryItem" ADD COLUMN     "count" DOUBLE PRECISION,
ADD COLUMN     "unit" TEXT,
ADD COLUMN     "unitPlural" TEXT;

-- AlterTable
ALTER TABLE "Favorite" ADD COLUMN     "portionCount" DOUBLE PRECISION,
ADD COLUMN     "portionUnit" TEXT,
ADD COLUMN     "portionUnitPlural" TEXT;
