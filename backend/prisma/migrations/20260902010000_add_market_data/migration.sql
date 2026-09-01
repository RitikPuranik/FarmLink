-- Module 6: additive market-data foundation. Existing application tables are untouched.
CREATE TYPE "MarketImportOperation" AS ENUM ('HISTORICAL_IMPORT', 'INCREMENTAL_SYNC');
CREATE TYPE "MarketImportStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'SKIPPED');

CREATE TABLE "mandis" (
  "id" TEXT NOT NULL, "publicId" TEXT NOT NULL, "source" TEXT NOT NULL, "sourceMarketId" TEXT,
  "name" TEXT NOT NULL, "normalizedName" TEXT NOT NULL, "state" TEXT NOT NULL,
  "district" TEXT NOT NULL, "latitude" DOUBLE PRECISION, "longitude" DOUBLE PRECISION,
  "sourceMetadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mandis_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mandis_source_sourceMarketId_key" ON "mandis"("source", "sourceMarketId");
CREATE UNIQUE INDEX "mandis_publicId_key" ON "mandis"("publicId");
CREATE UNIQUE INDEX "mandis_source_normalizedName_district_state_key" ON "mandis"("source", "normalizedName", "district", "state");
CREATE INDEX "mandis_state_district_idx" ON "mandis"("state", "district");
CREATE INDEX "mandis_latitude_longitude_idx" ON "mandis"("latitude", "longitude");

CREATE TABLE "mandi_prices" (
  "id" TEXT NOT NULL, "cropId" TEXT NOT NULL, "mandiId" TEXT NOT NULL, "source" TEXT NOT NULL,
  "sourceRecordId" TEXT, "observedDate" DATE NOT NULL, "minPrice" DECIMAL(14,2) NOT NULL,
  "maxPrice" DECIMAL(14,2) NOT NULL, "modalPrice" DECIMAL(14,2) NOT NULL,
  "arrivalQuantity" DECIMAL(14,2), "arrivalUnit" "QuantityUnit", "sourceMetadata" JSONB,
  "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mandi_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mandi_prices_cropId_mandiId_observedDate_source_key" ON "mandi_prices"("cropId", "mandiId", "observedDate", "source");
CREATE UNIQUE INDEX "mandi_prices_source_sourceRecordId_key" ON "mandi_prices"("source", "sourceRecordId");
CREATE INDEX "mandi_prices_cropId_observedDate_idx" ON "mandi_prices"("cropId", "observedDate");
CREATE INDEX "mandi_prices_mandiId_observedDate_idx" ON "mandi_prices"("mandiId", "observedDate");
CREATE INDEX "mandi_prices_cropId_mandiId_observedDate_idx" ON "mandi_prices"("cropId", "mandiId", "observedDate");
ALTER TABLE "mandi_prices" ADD CONSTRAINT "mandi_prices_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mandi_prices" ADD CONSTRAINT "mandi_prices_mandiId_fkey" FOREIGN KEY ("mandiId") REFERENCES "mandis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crop_aliases" ("id" TEXT NOT NULL, "cropId" TEXT NOT NULL, "source" TEXT NOT NULL, "alias" TEXT NOT NULL, "normalizedAlias" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "crop_aliases_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "crop_aliases_source_normalizedAlias_key" ON "crop_aliases"("source", "normalizedAlias");
CREATE INDEX "crop_aliases_cropId_idx" ON "crop_aliases"("cropId");
ALTER TABLE "crop_aliases" ADD CONSTRAINT "crop_aliases_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "market_data_import_runs" ("id" TEXT NOT NULL, "source" TEXT NOT NULL, "operation" "MarketImportOperation" NOT NULL, "status" "MarketImportStatus" NOT NULL DEFAULT 'RUNNING', "recordsRead" INTEGER NOT NULL DEFAULT 0, "recordsImported" INTEGER NOT NULL DEFAULT 0, "recordsUpdated" INTEGER NOT NULL DEFAULT 0, "recordsSkipped" INTEGER NOT NULL DEFAULT 0, "recordsRejected" INTEGER NOT NULL DEFAULT 0, "validationFailures" INTEGER NOT NULL DEFAULT 0, "partialFailures" INTEGER NOT NULL DEFAULT 0, "diagnostics" JSONB, "metadata" JSONB, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "market_data_import_runs_pkey" PRIMARY KEY ("id"));
CREATE INDEX "market_data_import_runs_source_operation_startedAt_idx" ON "market_data_import_runs"("source", "operation", "startedAt");
CREATE TABLE "market_data_sync_checkpoints" ("id" TEXT NOT NULL, "source" TEXT NOT NULL, "lastSuccessfulObservedDate" DATE, "cursor" TEXT, "metadata" JSONB, "lastSuccessfulSyncAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "market_data_sync_checkpoints_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "market_data_sync_checkpoints_source_key" ON "market_data_sync_checkpoints"("source");
