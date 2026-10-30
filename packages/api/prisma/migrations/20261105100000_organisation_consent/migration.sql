-- Consent and terms for organisations and Shop Partners (30 October 2026, Anthony; UK GDPR).
-- A person linking to an organisation is recorded with the moment they agreed and the version
-- of the words they saw; the organisation sees only orders placed from that moment on. A shop
-- joining records when it agreed to the Shop Partner terms, and an organisation asking to work
-- with us records when it agreed to the Organisation terms. An enquiry says whether it came
-- from a shop or an organisation. Each order's analysis row carries the Shop Partner's id, so
-- a café's commission is matched by id, not by a name that can change.

-- AlterTable
ALTER TABLE "Shopper" ADD COLUMN "organisationConsentAt" TIMESTAMP(3),
ADD COLUMN "organisationConsentVersion" TEXT;

-- AlterTable
ALTER TABLE "PartnerShop" ADD COLUMN "termsAgreedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "OrganisationEnquiry" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'organisation',
ADD COLUMN "termsAgreedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN "partnerShopId" TEXT;
