-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "missingNutrients" TEXT[] DEFAULT ARRAY[]::TEXT[];
