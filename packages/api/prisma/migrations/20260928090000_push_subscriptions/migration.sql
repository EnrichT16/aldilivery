-- The devices a Shopper has allowed to show notifications, so a Runner's question reaches them
-- when the Your order page is closed. Additive only: one new table. Deleting a Shopper deletes
-- their devices.

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_shopperId_idx" ON "PushSubscription"("shopperId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "Shopper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

