-- Module 9 Part 3 — Storage Conditions, Crop Suitability & Storage
-- Constraints.
--
-- Non-destructive / additive only: no existing column, index, or table is
-- altered or dropped. All new boolean columns are nullable with no default
-- (null = unknown, never assumed false — see the schema comments on
-- WarehouseStorageUnit and CropStorageRequirement for why).

-- Declared/configured storage capability columns on the existing
-- warehouse_storage_units table (Part 1). Temperature/humidity range and
-- storage_type already existed; this only adds the five boolean
-- capability flags this part's suitability engine compares crop
-- requirements against.
ALTER TABLE "warehouse_storage_units"
  ADD COLUMN "ventilationAvailable" BOOLEAN,
  ADD COLUMN "coldStorageAvailable" BOOLEAN,
  ADD COLUMN "controlledAtmosphereAvailable" BOOLEAN,
  ADD COLUMN "pestControlAvailable" BOOLEAN,
  ADD COLUMN "moistureControlAvailable" BOOLEAN;

-- Explicit, never-auto-generated crop storage requirements (see
-- CropStorageRequirement's own schema comment). A crop with no row here
-- is reported as UNKNOWN/INSUFFICIENT_DATA by the suitability engine, not
-- defaulted to any assumed requirement.
CREATE TABLE "crop_storage_requirements" (
    "id" TEXT NOT NULL,
    "cropId" TEXT NOT NULL,
    "preferredTemperatureMin" DECIMAL(5,2),
    "preferredTemperatureMax" DECIMAL(5,2),
    "preferredHumidityMin" DECIMAL(5,2),
    "preferredHumidityMax" DECIMAL(5,2),
    "requiresVentilation" BOOLEAN,
    "requiresColdStorage" BOOLEAN,
    "requiresControlledAtmosphere" BOOLEAN,
    "requiresPestControl" BOOLEAN,
    "requiresMoistureControl" BOOLEAN,
    "compatibleStorageTypes" "StorageType"[] NOT NULL DEFAULT ARRAY[]::"StorageType"[],
    "maximumRecommendedStorageDays" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_storage_requirements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crop_storage_requirements_cropId_key" ON "crop_storage_requirements"("cropId");
CREATE INDEX "crop_storage_requirements_cropId_idx" ON "crop_storage_requirements"("cropId");

ALTER TABLE "crop_storage_requirements"
  ADD CONSTRAINT "crop_storage_requirements_cropId_fkey"
  FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
