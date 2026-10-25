-- Browsing places by kind (25 October 2026, ruling 82). Restaurants, Shops, Convenience stores
-- and Services each have their own page. A place chooses its cuisines (a restaurant, cafe or
-- takeaway), its specialities (a shop) or its categories (a service) from the lists in
-- config/store.json; a shop can be marked as a convenience store; and a childminder gives its
-- Ofsted registration number, shown as given and never checked by us.

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "cuisines" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "specialities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "convenience" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ofstedNumber" TEXT NOT NULL DEFAULT '';
