import {
  QuantityUnit,
  VehicleAvailabilityStatus,
  VehicleCapability,
  VehicleStatus,
  VehicleType,
  VehicleVerificationStatus,
} from "@prisma/client";
import { toCapacityDisplay } from "./vehicle-capacity";

export interface VehicleRecord {
  id: string;
  publicId: string;
  transporterId: string;
  registrationNumber: string;
  normalizedRegistrationNumber: string;
  vehicleType: VehicleType;
  capacityUnit: QuantityUnit;
  capacityKg: unknown; // Prisma.Decimal at runtime — see toVehiclePublicDTO
  capabilities: VehicleCapability[];
  isRefrigerated: boolean;
  status: VehicleStatus;
  verificationStatus: VehicleVerificationStatus;
  availabilityStatus: VehicleAvailabilityStatus;
  availabilityUpdatedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateVehicleData {
  transporterId: string;
  registrationNumber: string;
  normalizedRegistrationNumber: string;
  vehicleType: VehicleType;
  capacityUnit: QuantityUnit;
  capacityKg: number;
  capabilities: VehicleCapability[];
  isRefrigerated: boolean;
}

export interface UpdateVehicleData {
  vehicleType?: VehicleType;
  capacityUnit?: QuantityUnit;
  capacityKg?: number;
  capabilities?: VehicleCapability[];
  isRefrigerated?: boolean;
}

/**
 * Part N — Transporter Discovery filters. Every field here is a stored,
 * declared attribute — never a computed price, distance, or rank.
 */
export interface VehicleDiscoveryFilters {
  vehicleType?: VehicleType;
  minimumCapacityKg?: number;
  refrigerated?: boolean;
  availabilityStatus?: VehicleAvailabilityStatus;
  verificationStatus?: VehicleVerificationStatus;
}

/**
 * Part S — Vehicle DTO. registrationNumber (display form) is shown; the
 * normalized form is an internal duplicate-prevention detail and never
 * leaves the repository/service layer.
 */
export interface VehiclePublicDTO {
  vehicleId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  capacity: { value: number; unit: QuantityUnit };
  capabilities: VehicleCapability[];
  isRefrigerated: boolean;
  availabilityStatus: VehicleAvailabilityStatus;
  verificationStatus: VehicleVerificationStatus;
  status: VehicleStatus;
  createdAt: string;
  updatedAt: string;
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function toVehiclePublicDTO(row: VehicleRecord): VehiclePublicDTO {
  return {
    vehicleId: row.publicId,
    registrationNumber: row.registrationNumber,
    vehicleType: row.vehicleType,
    capacity: toCapacityDisplay(toNumber(row.capacityKg), row.capacityUnit),
    capabilities: row.capabilities,
    isRefrigerated: row.isRefrigerated,
    availabilityStatus: row.availabilityStatus,
    verificationStatus: row.verificationStatus,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
