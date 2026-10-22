CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "CatalogSource" AS ENUM ('foundation', 'sr_legacy', 'survey');

CREATE TABLE "CatalogFood" (
    "id" INTEGER NOT NULL,
    "source" "CatalogSource" NOT NULL,
    "name" TEXT NOT NULL,
    "searchName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "satFat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL,
    "sugar" DOUBLE PRECISION NOT NULL,
    "sodium" DOUBLE PRECISION NOT NULL,
    "alcohol" DOUBLE PRECISION NOT NULL,
    "missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "microsPer100" JSONB,
    "portions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "CatalogFood_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogDataset" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "foodCount" INTEGER NOT NULL,
    "loadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogDataset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogFood_group_idx" ON "CatalogFood"("group");

CREATE INDEX "CatalogFood_searchName_idx" ON "CatalogFood" USING GIN ("searchName" gin_trgm_ops);
