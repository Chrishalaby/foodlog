-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "hiddenFoods" TEXT[] DEFAULT ARRAY[]::TEXT[];
