-- Module 7 Part 1: price forecasting foundation. Additive only — no existing
-- table, column, or row (including MandiPrice, the authoritative historical
-- price source) is altered.
CREATE TYPE "PriceForecastScopeType" AS ENUM ('MANDI','REGIONAL','CROP_WIDE');
CREATE TYPE "PriceForecastStatus" AS ENUM ('GENERATING','COMPLETED','FAILED','INSUFFICIENT_DATA');
CREATE TABLE "price_forecasts" ("id" TEXT NOT NULL,"publicId" TEXT NOT NULL,"cropId" TEXT NOT NULL,"scopeType" "PriceForecastScopeType" NOT NULL,"mandiId" TEXT,"regionState" TEXT,"regionDistrict" TEXT,"scopeKey" TEXT NOT NULL,"targetDate" DATE NOT NULL,"horizonDays" INTEGER NOT NULL,"predictedPrice" DECIMAL(14,2) NOT NULL,"lowerBound" DECIMAL(14,2),"upperBound" DECIMAL(14,2),"confidenceScore" DECIMAL(4,3),"status" "PriceForecastStatus" NOT NULL DEFAULT 'GENERATING',"modelProvider" TEXT NOT NULL,"modelVersion" TEXT NOT NULL,"inputDataStartDate" DATE,"inputDataEndDate" DATE,"sampleCount" INTEGER,"generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"expiresAt" TIMESTAMP(3),"metadata" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "price_forecasts_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "price_forecasts_publicId_key" ON "price_forecasts"("publicId");
CREATE UNIQUE INDEX "price_forecasts_cropId_scopeKey_targetDate_modelVersion_key" ON "price_forecasts"("cropId","scopeKey","targetDate","modelVersion");
CREATE INDEX "price_forecasts_cropId_targetDate_idx" ON "price_forecasts"("cropId","targetDate");
CREATE INDEX "price_forecasts_cropId_mandiId_targetDate_idx" ON "price_forecasts"("cropId","mandiId","targetDate");
CREATE INDEX "price_forecasts_status_idx" ON "price_forecasts"("status");
CREATE INDEX "price_forecasts_expiresAt_idx" ON "price_forecasts"("expiresAt");
ALTER TABLE "price_forecasts" ADD CONSTRAINT "price_forecasts_cropId_fkey" FOREIGN KEY("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_forecasts" ADD CONSTRAINT "price_forecasts_mandiId_fkey" FOREIGN KEY("mandiId") REFERENCES "mandis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
