import { TransporterDomainError } from "../../common/errors";
import { QuantityUnit, convertKgToQuantity, convertQuantityToKg } from "../fpo/unit-conversion";

export interface VehicleCapacityInput {
  value: number;
  unit: QuantityUnit;
}

export interface VehicleCapacityDisplay {
  value: number;
  unit: QuantityUnit;
}

/**
 * Part E — Capacity must be explicit, Decimal-safe, and normalized to the
 * canonical internal unit (KG — same convention CropLot/Warehouse already
 * use, see modules/fpo/unit-conversion.ts). Rejects negative, zero, NaN,
 * Infinity, and unsupported units. Returns the canonical KG value the
 * repository persists as Vehicle.capacityKg.
 */
export function validateAndNormalizeCapacity(input: VehicleCapacityInput): number {
  const { value, unit } = input;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TransporterDomainError("Vehicle capacity must be a finite number.", "INVALID_VEHICLE_CAPACITY");
  }

  if (value <= 0) {
    throw new TransporterDomainError("Vehicle capacity must be greater than zero.", "INVALID_VEHICLE_CAPACITY");
  }

  if (unit !== "KG" && unit !== "QTL" && unit !== "TONNE") {
    throw new TransporterDomainError(`Unsupported capacity unit: ${unit}.`, "INVALID_VEHICLE_CAPACITY");
  }

  const capacityKg = convertQuantityToKg(value, unit);

  if (!Number.isFinite(capacityKg) || capacityKg <= 0) {
    throw new TransporterDomainError("Vehicle capacity must be greater than zero.", "INVALID_VEHICLE_CAPACITY");
  }

  return capacityKg;
}

/** Converts a stored canonical capacityKg back into the transporter's
 * declared display unit — same round-trip CropLot's own DTO mapper uses. */
export function toCapacityDisplay(capacityKg: number, displayUnit: QuantityUnit): VehicleCapacityDisplay {
  return { value: convertKgToQuantity(capacityKg, displayUnit), unit: displayUnit };
}
