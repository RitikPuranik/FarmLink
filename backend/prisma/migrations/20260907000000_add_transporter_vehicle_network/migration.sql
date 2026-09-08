-- Module 15 — Transporter & Vehicle Network.
--
-- Purely additive: four new tables and seven new enums. No existing
-- table, column, index, or enum value is altered or dropped. The
-- back-relation added to the Prisma `User` model (`transporterProfile`)
-- has no corresponding schema change here — it is the reverse side of the
-- new TransporterProfile.userId foreign key below and requires no DDL of
-- its own.

CREATE TYPE "TransporterVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

CREATE TYPE "VehicleType" AS ENUM ('MINI_TRUCK', 'PICKUP', 'LIGHT_TRUCK', 'MEDIUM_TRUCK', 'HEAVY_TRUCK', 'TRACTOR_TROLLEY', 'REFRIGERATED_TRUCK', 'OTHER');

CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'SUSPENDED');

CREATE TYPE "VehicleVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- RESERVED/IN_TRANSIT are included for forward-compatibility with Module
-- 16 (Logistics Quote & Optimization) and Module 17 (Shipment & GPS
-- Tracking) only — no code in this module ever writes either value.
CREATE TYPE "VehicleAvailabilityStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'RESERVED', 'IN_TRANSIT');

CREATE TYPE "ServiceAreaType" AS ENUM ('STATE', 'DISTRICT', 'CITY', 'PINCODE');

-- Deliberately excludes a "REFRIGERATED" member — that is already its own
-- indexed boolean, Vehicle.isRefrigerated (Part D of the module spec).
CREATE TYPE "VehicleCapability" AS ENUM ('COVERED', 'OPEN_BODY', 'TEMPERATURE_CONTROLLED', 'BULK_TRANSPORT', 'SMALL_LOAD_SUITABLE', 'LARGE_LOAD_SUITABLE');

-- ---------------------------------------------------------------------
-- TransporterProfile
-- ---------------------------------------------------------------------

CREATE TABLE "transporter_profiles" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "verificationStatus" "TransporterVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transporter_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transporter_profiles_publicId_key" ON "transporter_profiles"("publicId");
CREATE UNIQUE INDEX "transporter_profiles_userId_key" ON "transporter_profiles"("userId");
CREATE INDEX "transporter_profiles_verificationStatus_idx" ON "transporter_profiles"("verificationStatus");
CREATE INDEX "transporter_profiles_isActive_idx" ON "transporter_profiles"("isActive");

ALTER TABLE "transporter_profiles"
  ADD CONSTRAINT "transporter_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Vehicle
-- ---------------------------------------------------------------------

CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "transporterId" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "normalizedRegistrationNumber" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "capacityUnit" "QuantityUnit" NOT NULL DEFAULT 'KG',
    "capacityKg" DECIMAL(12,2) NOT NULL,
    "capabilities" "VehicleCapability"[] NOT NULL DEFAULT ARRAY[]::"VehicleCapability"[],
    "isRefrigerated" BOOLEAN NOT NULL DEFAULT false,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "verificationStatus" "VehicleVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "availabilityStatus" "VehicleAvailabilityStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "availabilityUpdatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicles_publicId_key" ON "vehicles"("publicId");
CREATE UNIQUE INDEX "vehicles_normalizedRegistrationNumber_key" ON "vehicles"("normalizedRegistrationNumber");
CREATE INDEX "vehicles_transporterId_idx" ON "vehicles"("transporterId");
CREATE INDEX "vehicles_vehicleType_idx" ON "vehicles"("vehicleType");
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");
CREATE INDEX "vehicles_verificationStatus_idx" ON "vehicles"("verificationStatus");
CREATE INDEX "vehicles_availabilityStatus_idx" ON "vehicles"("availabilityStatus");
CREATE INDEX "vehicles_capacityKg_idx" ON "vehicles"("capacityKg");

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_transporterId_fkey"
  FOREIGN KEY ("transporterId") REFERENCES "transporter_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- TransporterServiceArea
-- ---------------------------------------------------------------------

CREATE TABLE "transporter_service_areas" (
    "id" TEXT NOT NULL,
    "transporterId" TEXT NOT NULL,
    "areaType" "ServiceAreaType" NOT NULL,
    "state" TEXT,
    "district" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transporter_service_areas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transporter_service_areas_transporterId_idx" ON "transporter_service_areas"("transporterId");
CREATE INDEX "transporter_service_areas_state_idx" ON "transporter_service_areas"("state");
CREATE INDEX "transporter_service_areas_district_idx" ON "transporter_service_areas"("district");

ALTER TABLE "transporter_service_areas"
  ADD CONSTRAINT "transporter_service_areas_transporterId_fkey"
  FOREIGN KEY ("transporterId") REFERENCES "transporter_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- VehicleDriver (schema-only foundation — Part H; no route reads/writes
-- this table yet, see docs/modules/module-15-transporter-vehicle-network.md)
-- ---------------------------------------------------------------------

CREATE TABLE "vehicle_drivers" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "transporterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "licenseNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_drivers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_drivers_vehicleId_key" ON "vehicle_drivers"("vehicleId");
CREATE INDEX "vehicle_drivers_transporterId_idx" ON "vehicle_drivers"("transporterId");

ALTER TABLE "vehicle_drivers"
  ADD CONSTRAINT "vehicle_drivers_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
