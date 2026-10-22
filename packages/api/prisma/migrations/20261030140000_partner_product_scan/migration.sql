-- Scanning products in the partner dashboard (22 October 2026, ruling 75): a product keeps the
-- barcode it was scanned with, so one scan covers every identical pack and the same product is
-- never listed twice; and a product whose label showed no price carries an estimate, marked so
-- the shop and the owner can check it.
ALTER TABLE "PartnerProduct" ADD COLUMN "barcode" TEXT;
ALTER TABLE "PartnerProduct" ADD COLUMN "priceEstimated" BOOLEAN NOT NULL DEFAULT false;
