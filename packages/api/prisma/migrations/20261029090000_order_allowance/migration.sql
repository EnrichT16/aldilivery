-- The monthly order allowance (20 October 2026, ruling 73): an order past the Shopper's plan
-- allowance carries an extra delivery charge, kept on the order so the basket, the
-- confirmation and the receipt can show it as its own line. Not shop goods: the till never
-- sees it, and it goes to the business, never to the Runner.
ALTER TABLE "Order" ADD COLUMN "allowanceExtraPence" INTEGER NOT NULL DEFAULT 0;
