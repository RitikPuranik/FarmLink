-- Module 9 Part 1: warehouse intelligence foundation. Additive only — no
-- existing table, column, or row is altered, renamed, or dropped. Adds five
-- new tables (warehouses, warehouse_storage_units, warehouse_crop_capabilities,
-- storage_reservations, storage_rates) and their enums/indexes/foreign keys.
CREATE TYPE "WarehouseStatus" AS ENUM ('ACTIVE','INACTIVE','SUSPENDED');
CREATE TYPE "WarehouseOwnerType" AS ENUM ('USER','FPO');
CREATE TYPE "StorageType" AS ENUM ('AMBIENT','COLD_STORAGE','CONTROLLED_ATMOSPHERE','SILO','WAREHOUSE_GODOWN','OTHER');
CREATE TYPE "CropStorageCompatibility" AS ENUM ('COMPATIBLE','NOT_RECOMMENDED','INCOMPATIBLE');
CREATE TYPE "StorageReservationStatus" AS ENUM ('PENDING','CONFIRMED','CANCELLED','EXPIRED','COMPLETED');
CREATE TYPE "StorageRateType" AS ENUM ('PER_DAY','PER_WEEK','PER_MONTH','PER_QUANTITY_PER_DAY');

CREATE TABLE "warehouses" ("id" TEXT NOT NULL,"publicId" TEXT NOT NULL,"ownerType" "WarehouseOwnerType" NOT NULL,"ownerUserId" TEXT,"ownerFpoId" TEXT,"name" TEXT NOT NULL,"warehouseType" "StorageType" NOT NULL DEFAULT 'AMBIENT',"state" TEXT NOT NULL,"district" TEXT NOT NULL,"address" TEXT,"latitude" DOUBLE PRECISION,"longitude" DOUBLE PRECISION,"verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',"status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',"isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "warehouses_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "warehouses_publicId_key" ON "warehouses"("publicId");
CREATE INDEX "warehouses_ownerUserId_idx" ON "warehouses"("ownerUserId");
CREATE INDEX "warehouses_ownerFpoId_idx" ON "warehouses"("ownerFpoId");
CREATE INDEX "warehouses_state_district_idx" ON "warehouses"("state","district");
CREATE INDEX "warehouses_status_idx" ON "warehouses"("status");
CREATE INDEX "warehouses_verificationStatus_idx" ON "warehouses"("verificationStatus");
CREATE INDEX "warehouses_createdAt_idx" ON "warehouses"("createdAt");
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_ownerUserId_fkey" FOREIGN KEY("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_ownerFpoId_fkey" FOREIGN KEY("ownerFpoId") REFERENCES "fpos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "warehouse_storage_units" ("id" TEXT NOT NULL,"publicId" TEXT NOT NULL,"warehouseId" TEXT NOT NULL,"code" TEXT NOT NULL,"storageType" "StorageType" NOT NULL DEFAULT 'AMBIENT',"totalCapacity" DECIMAL(14,2) NOT NULL,"availableCapacity" DECIMAL(14,2) NOT NULL,"capacityUnit" "QuantityUnit" NOT NULL DEFAULT 'KG',"temperatureControlled" BOOLEAN NOT NULL DEFAULT false,"minTemperature" DECIMAL(5,2),"maxTemperature" DECIMAL(5,2),"humidityControlled" BOOLEAN NOT NULL DEFAULT false,"minHumidity" DECIMAL(5,2),"maxHumidity" DECIMAL(5,2),"isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "warehouse_storage_units_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "warehouse_storage_units_publicId_key" ON "warehouse_storage_units"("publicId");
CREATE UNIQUE INDEX "warehouse_storage_units_warehouseId_code_key" ON "warehouse_storage_units"("warehouseId","code");
CREATE INDEX "warehouse_storage_units_warehouseId_idx" ON "warehouse_storage_units"("warehouseId");
CREATE INDEX "warehouse_storage_units_storageType_idx" ON "warehouse_storage_units"("storageType");
ALTER TABLE "warehouse_storage_units" ADD CONSTRAINT "warehouse_storage_units_warehouseId_fkey" FOREIGN KEY("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "warehouse_crop_capabilities" ("id" TEXT NOT NULL,"warehouseId" TEXT NOT NULL,"storageUnitId" TEXT,"cropId" TEXT NOT NULL,"compatibility" "CropStorageCompatibility" NOT NULL DEFAULT 'COMPATIBLE',"maxStorageDurationDays" INTEGER,"storageConditions" TEXT,"estimatedSpoilageRatePercent" DECIMAL(5,2),"metadata" JSONB,"isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "warehouse_crop_capabilities_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "warehouse_crop_capabilities_warehouseId_storageUnitId_cropId_key" ON "warehouse_crop_capabilities"("warehouseId","storageUnitId","cropId");
CREATE INDEX "warehouse_crop_capabilities_warehouseId_idx" ON "warehouse_crop_capabilities"("warehouseId");
CREATE INDEX "warehouse_crop_capabilities_storageUnitId_idx" ON "warehouse_crop_capabilities"("storageUnitId");
CREATE INDEX "warehouse_crop_capabilities_cropId_idx" ON "warehouse_crop_capabilities"("cropId");
ALTER TABLE "warehouse_crop_capabilities" ADD CONSTRAINT "warehouse_crop_capabilities_warehouseId_fkey" FOREIGN KEY("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_crop_capabilities" ADD CONSTRAINT "warehouse_crop_capabilities_storageUnitId_fkey" FOREIGN KEY("storageUnitId") REFERENCES "warehouse_storage_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_crop_capabilities" ADD CONSTRAINT "warehouse_crop_capabilities_cropId_fkey" FOREIGN KEY("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "storage_reservations" ("id" TEXT NOT NULL,"publicId" TEXT NOT NULL,"warehouseId" TEXT NOT NULL,"storageUnitId" TEXT,"lotId" TEXT NOT NULL,"quantity" DECIMAL(14,2) NOT NULL,"unit" "QuantityUnit" NOT NULL DEFAULT 'KG',"status" "StorageReservationStatus" NOT NULL DEFAULT 'PENDING',"reservedFrom" TIMESTAMP(3) NOT NULL,"reservedUntil" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "storage_reservations_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "storage_reservations_publicId_key" ON "storage_reservations"("publicId");
CREATE INDEX "storage_reservations_warehouseId_status_idx" ON "storage_reservations"("warehouseId","status");
CREATE INDEX "storage_reservations_storageUnitId_status_idx" ON "storage_reservations"("storageUnitId","status");
CREATE INDEX "storage_reservations_lotId_idx" ON "storage_reservations"("lotId");
CREATE INDEX "storage_reservations_status_idx" ON "storage_reservations"("status");
CREATE INDEX "storage_reservations_reservedFrom_idx" ON "storage_reservations"("reservedFrom");
CREATE INDEX "storage_reservations_reservedUntil_idx" ON "storage_reservations"("reservedUntil");
ALTER TABLE "storage_reservations" ADD CONSTRAINT "storage_reservations_warehouseId_fkey" FOREIGN KEY("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storage_reservations" ADD CONSTRAINT "storage_reservations_storageUnitId_fkey" FOREIGN KEY("storageUnitId") REFERENCES "warehouse_storage_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storage_reservations" ADD CONSTRAINT "storage_reservations_lotId_fkey" FOREIGN KEY("lotId") REFERENCES "crop_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "storage_rates" ("id" TEXT NOT NULL,"publicId" TEXT NOT NULL,"warehouseId" TEXT NOT NULL,"storageUnitId" TEXT,"cropId" TEXT,"rateType" "StorageRateType" NOT NULL,"rateAmount" DECIMAL(10,2) NOT NULL,"currency" TEXT NOT NULL DEFAULT 'INR',"billingUnit" "QuantityUnit" NOT NULL DEFAULT 'KG',"effectiveFrom" TIMESTAMP(3) NOT NULL,"effectiveUntil" TIMESTAMP(3),"isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "storage_rates_pkey" PRIMARY KEY("id"));
CREATE UNIQUE INDEX "storage_rates_publicId_key" ON "storage_rates"("publicId");
CREATE INDEX "storage_rates_warehouseId_isActive_idx" ON "storage_rates"("warehouseId","isActive");
CREATE INDEX "storage_rates_storageUnitId_idx" ON "storage_rates"("storageUnitId");
CREATE INDEX "storage_rates_cropId_idx" ON "storage_rates"("cropId");
CREATE INDEX "storage_rates_effectiveFrom_effectiveUntil_idx" ON "storage_rates"("effectiveFrom","effectiveUntil");
ALTER TABLE "storage_rates" ADD CONSTRAINT "storage_rates_warehouseId_fkey" FOREIGN KEY("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storage_rates" ADD CONSTRAINT "storage_rates_storageUnitId_fkey" FOREIGN KEY("storageUnitId") REFERENCES "warehouse_storage_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storage_rates" ADD CONSTRAINT "storage_rates_cropId_fkey" FOREIGN KEY("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
