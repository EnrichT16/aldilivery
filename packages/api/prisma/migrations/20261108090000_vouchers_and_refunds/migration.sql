-- Partner mark-ups, sent vouchers and orders no Runner takes (Anthony, 30 October 2026).
--
-- Mark-up: a partner, a restaurant or a grocery shop, may have an agreed mark-up on its prices,
-- set by staff, 0 for none. Shoppers see and pay the shop price with it on; the Runner pays the
-- shop price less any discount at the counter. Each partner thing in an order keeps its shop
-- price and its counter price as they were when the order was placed.

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "agreedMarkupPercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "shopPricePence" INTEGER,
ADD COLUMN "counterPricePence" INTEGER;
