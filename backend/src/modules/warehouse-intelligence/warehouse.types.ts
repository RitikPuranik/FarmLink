import {
  Crop,
  CropStorageCompatibility,
  QuantityUnit,
  StorageRate,
  StorageRateType,
  StorageReservation,
  StorageReservationStatus,
  StorageType,
  Warehouse,
  WarehouseCropCapability,
  WarehouseOwnerType,
  WarehouseStatus,
  WarehouseStorageUnit,
  VerificationStatus,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Clean domain types (never raw Prisma rows exposed beyond this module —
// mirrors lots.types.ts's CropLotDTO/toCropLotDTO convention).
// ---------------------------------------------------------------------------

export interface WarehouseLocation {
  state: string;
  district: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface WarehouseCapacity {
  total: number;
  available: number;
  unit: QuantityUnit;
}

export interface StorageConditions {
  temperatureControlled: boolean;
  minTemperature: number | null;
  maxTemperature: number | null;
  humidityControlled: boolean;
  minHumidity: number | null;
  maxHumidity: number | null;
}

export type WarehouseWithRelations = Warehouse;
export type WarehouseStorageUnitWithRelations = WarehouseStorageUnit;
export type WarehouseCropCapabilityWithRelations = WarehouseCropCapability & { crop: Crop };
export type StorageReservationWithRelations = StorageReservation;
export type StorageRateWithRelations = StorageRate & { crop: Crop | null };

// ---------------------------------------------------------------------------
// Module 9 Part 2 additions — read shapes for capacity/availability queries.
// Kept separate from the Part 1 types above (which stay untouched) rather
// than widening WarehouseWithRelations itself, since most Part 1 call
// sites never need storage units/capabilities eagerly loaded.
// ---------------------------------------------------------------------------

/** A warehouse plus everything the availability/nearby-search service
 * needs in one round trip: active storage units (for capacity
 * aggregation) and crop capability rows (for compatibility resolution,
 * only ever loaded pre-scoped to a specific cropId by the repository). */
export type WarehouseWithCapacity = Warehouse & {
  storageUnits: WarehouseStorageUnit[];
  capabilities: WarehouseCropCapabilityWithRelations[];
};

export interface WarehouseCapacitySummaryDTO {
  totalKg: number | null;
  availableKg: number | null;
  utilizationPercent: number | null;
  status: "AVAILABLE" | "LIMITED" | "FULL" | "UNAVAILABLE";
  storageUnitCount: number;
}

export interface WarehouseAvailabilityDTO {
  warehouse: WarehouseDTO;
  capacity: WarehouseCapacitySummaryDTO;
  requestedCrop: { id: string; name: string } | null;
  compatibility: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | null;
  requestedQuantity: { value: number; unit: QuantityUnit } | null;
  canAccommodate: boolean | null;
}

export interface NearbyWarehouseResultDTO extends WarehouseAvailabilityDTO {
  distanceKm: number;
}

export interface WarehouseDTO {
  publicId: string;
  ownerType: WarehouseOwnerType;
  owner: { userId: string | null; fpoId: string | null };
  name: string;
  warehouseType: StorageType;
  location: WarehouseLocation;
  verificationStatus: VerificationStatus;
  status: WarehouseStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseCapability {
  crop: { id: string; name: string };
  compatibility: CropStorageCompatibility;
  storageUnitId: string | null;
  maxStorageDurationDays: number | null;
  storageConditions: string | null;
  estimatedSpoilageRatePercent: number | null;
  isActive: boolean;
}

export interface WarehouseStorageUnitDTO {
  publicId: string;
  code: string;
  storageType: StorageType;
  capacity: WarehouseCapacity;
  conditions: StorageConditions;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorageReservationRecord {
  publicId: string;
  warehouseId: string;
  storageUnitId: string | null;
  lotId: string;
  quantity: number;
  unit: QuantityUnit;
  status: StorageReservationStatus;
  reservedFrom: string;
  reservedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageRateDefinition {
  publicId: string;
  warehouseId: string;
  storageUnitId: string | null;
  crop: { id: string; name: string } | null;
  rateType: StorageRateType;
  rateAmount: number;
  currency: string;
  billingUnit: QuantityUnit;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Mappers — Decimal -> number, Date -> ISO string, never exposing the raw
// Prisma row shape past this module (same discipline as lots.types.ts).
// ---------------------------------------------------------------------------

export function toWarehouseDTO(row: WarehouseWithRelations): WarehouseDTO {
  return {
    publicId: row.publicId,
    ownerType: row.ownerType,
    owner: { userId: row.ownerUserId, fpoId: row.ownerFpoId },
    name: row.name,
    warehouseType: row.warehouseType,
    location: {
      state: row.state,
      district: row.district,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    verificationStatus: row.verificationStatus,
    status: row.status,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWarehouseStorageUnitDTO(row: WarehouseStorageUnitWithRelations): WarehouseStorageUnitDTO {
  return {
    publicId: row.publicId,
    code: row.code,
    storageType: row.storageType,
    capacity: {
      total: Number(row.totalCapacity),
      available: Number(row.availableCapacity),
      unit: row.capacityUnit,
    },
    conditions: {
      temperatureControlled: row.temperatureControlled,
      minTemperature: row.minTemperature === null ? null : Number(row.minTemperature),
      maxTemperature: row.maxTemperature === null ? null : Number(row.maxTemperature),
      humidityControlled: row.humidityControlled,
      minHumidity: row.minHumidity === null ? null : Number(row.minHumidity),
      maxHumidity: row.maxHumidity === null ? null : Number(row.maxHumidity),
    },
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWarehouseCapability(row: WarehouseCropCapabilityWithRelations): WarehouseCapability {
  return {
    crop: { id: row.crop.id, name: row.crop.name },
    compatibility: row.compatibility,
    storageUnitId: row.storageUnitId,
    maxStorageDurationDays: row.maxStorageDurationDays,
    storageConditions: row.storageConditions,
    estimatedSpoilageRatePercent:
      row.estimatedSpoilageRatePercent === null ? null : Number(row.estimatedSpoilageRatePercent),
    isActive: row.isActive,
  };
}

export function toStorageReservationRecord(row: StorageReservationWithRelations): StorageReservationRecord {
  return {
    publicId: row.publicId,
    warehouseId: row.warehouseId,
    storageUnitId: row.storageUnitId,
    lotId: row.lotId,
    quantity: Number(row.quantity),
    unit: row.unit,
    status: row.status,
    reservedFrom: row.reservedFrom.toISOString(),
    reservedUntil: row.reservedUntil === null ? null : row.reservedUntil.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toStorageRateDefinition(row: StorageRateWithRelations): StorageRateDefinition {
  return {
    publicId: row.publicId,
    warehouseId: row.warehouseId,
    storageUnitId: row.storageUnitId,
    crop: row.crop === null ? null : { id: row.crop.id, name: row.crop.name },
    rateType: row.rateType,
    rateAmount: Number(row.rateAmount),
    currency: row.currency,
    billingUnit: row.billingUnit,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveUntil: row.effectiveUntil === null ? null : row.effectiveUntil.toISOString(),
    isActive: row.isActive,
  };
}
