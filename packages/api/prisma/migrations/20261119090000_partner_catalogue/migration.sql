-- The Shop Partner catalogue, built the way the professionals build it (Anthony, 5 November 2026,
-- ruling 96). Additive only: nothing is dropped or renamed, and every new column has a default or
-- may be null, so the rows already there read as they did.
--
-- * PartnerProduct: a description, a category from the taxonomy in config/store.json, a size
--   (unitQuantity and unitKind) so a unit price can be shown, the allergens it contains (and
--   whether the shop has said), featured and sortOrder for a Pro shop's own ordering, a variant
--   group and label for sizes and packs of one product, and updatedAt.
-- * PartnerProductPhoto: one row per photo, up to the package's photosPerProduct, the first the
--   cover; the bytes live in object storage (DigitalOcean Spaces) or, until that is set up, in
--   StoredFile, under the same keys, in three sizes as WebP with a JPEG beside each.
-- * StoredFile: the database fallback for files when no object storage is set up.
-- * OwnerMatter.priority: a Pro shop's products are read and listed first (approvalPriority).

-- AlterTable
ALTER TABLE "PartnerProduct" ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "unitQuantity" DOUBLE PRECISION,
ADD COLUMN "unitKind" TEXT,
ADD COLUMN "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "allergensGiven" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "variantGroupId" TEXT,
ADD COLUMN "variantLabel" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "PartnerProduct_variantGroupId_idx" ON "PartnerProduct"("variantGroupId");

-- CreateTable
CREATE TABLE "PartnerProductPhoto" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "storage" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "mediumKey" TEXT NOT NULL,
    "fullKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerProductPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerProductPhoto_productId_position_idx" ON "PartnerProductPhoto"("productId", "position");

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_key_key" ON "StoredFile"("key");

-- AlterTable
ALTER TABLE "OwnerMatter" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
