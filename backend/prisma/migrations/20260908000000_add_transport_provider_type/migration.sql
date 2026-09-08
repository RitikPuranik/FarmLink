-- Module 15 architecture correction — Transport Provider / Organization
-- clarification.
--
-- Purely additive: one new enum and two new nullable/defaulted columns on
-- the existing "transporter_profiles" table. No table is created, renamed,
-- or dropped, no existing column is altered or dropped, and no existing
-- data is touched beyond the new columns taking their default value.
--
-- The TransporterProfile -> Vehicle[] relationship itself is unchanged —
-- it already supported one provider owning many vehicles before this
-- migration. This migration only makes the provider's *type* (individual
-- owner-operator vs. business vs. company vs. cooperative vs. logistics
-- provider) explicit and queryable.

CREATE TYPE "TransportProviderType" AS ENUM ('INDIVIDUAL', 'BUSINESS', 'COMPANY', 'COOPERATIVE', 'LOGISTICS_PROVIDER');

ALTER TABLE "transporter_profiles"
  ADD COLUMN "providerType" "TransportProviderType" NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN "legalName" TEXT;

CREATE INDEX "transporter_profiles_providerType_idx" ON "transporter_profiles"("providerType");
