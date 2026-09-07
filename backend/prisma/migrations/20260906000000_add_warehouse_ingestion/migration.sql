-- Warehouse Ecosystem Ingestion Layer.
--
-- Non-destructive / additive only: no existing column, index, table, or
-- enum value is altered or dropped. Existing Warehouse rows (ownerType
-- USER/FPO) are completely unaffected — the new enum values are simply
-- never used by any existing code path, and the new pincode column is
-- nullable with no default (existing rows read back as NULL).

-- Two new WarehouseOwnerType members for warehouses ingested from an
-- external source with no FarmLink user/FPO behind them. Postgres enum
-- values can only be added, never removed/renamed in a single statement,
-- which matches this migration's own "additive only" requirement.
ALTER TYPE "WarehouseOwnerType" ADD VALUE 'GOVERNMENT';
ALTER TYPE "WarehouseOwnerType" ADD VALUE 'PRIVATE_PARTNER';

-- Optional pincode on Warehouse, used only as a conservative
-- duplicate-detection signal by the ingestion layer.
ALTER TABLE "warehouses" ADD COLUMN "pincode" TEXT;

-- Provenance/idempotency table. See the schema.prisma comment on
-- WarehouseSourceReference for why this is a separate table rather than
-- columns on Warehouse itself.
CREATE TYPE "WarehouseSourceType" AS ENUM ('FARMLINK', 'GOVERNMENT', 'PRIVATE_PARTNER');

CREATE TABLE "warehouse_source_references" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "sourceType" "WarehouseSourceType" NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_source_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_source_references_providerId_externalId_key" ON "warehouse_source_references"("providerId", "externalId");
CREATE INDEX "warehouse_source_references_warehouseId_idx" ON "warehouse_source_references"("warehouseId");
CREATE INDEX "warehouse_source_references_sourceType_idx" ON "warehouse_source_references"("sourceType");

ALTER TABLE "warehouse_source_references"
  ADD CONSTRAINT "warehouse_source_references_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
