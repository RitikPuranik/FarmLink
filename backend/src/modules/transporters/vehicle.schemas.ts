import { z } from "zod";

const publicId = z.string().uuid("This value is not valid.");
const vehicleType = z.enum([
  "MINI_TRUCK",
  "PICKUP",
  "LIGHT_TRUCK",
  "MEDIUM_TRUCK",
  "HEAVY_TRUCK",
  "TRACTOR_TROLLEY",
  "REFRIGERATED_TRUCK",
  "OTHER",
]);
const vehicleCapability = z.enum([
  "COVERED",
  "OPEN_BODY",
  "TEMPERATURE_CONTROLLED",
  "BULK_TRANSPORT",
  "SMALL_LOAD_SUITABLE",
  "LARGE_LOAD_SUITABLE",
]);
const quantityUnit = z.enum(["KG", "QTL", "TONNE"]);
const vehicleStatus = z.enum(["ACTIVE", "INACTIVE", "MAINTENANCE", "SUSPENDED"]);
const vehicleVerificationStatus = z.enum(["PENDING", "VERIFIED", "REJECTED"]);

export const vehiclePublicIdParams = z.object({ publicId });

export const registerVehicleBody = z
  .object({
    registrationNumber: z.string().trim().min(1).max(20),
    vehicleType,
    capacityValue: z.coerce.number().finite("Capacity must be a finite number.").positive("Capacity must be greater than zero."),
    capacityUnit: quantityUnit.default("KG"),
    capabilities: z.array(vehicleCapability).max(10).optional(),
    isRefrigerated: z.boolean().optional(),
  })
  .strict();

/** Part 11 — bulk onboarding. Capped at 50 per request: large enough for
 * a realistic fleet-onboarding batch, small enough to keep the all-or-
 * nothing transaction (see VehicleRepository.createMany) bounded. */
const bulkVehicleItem = z
  .object({
    registrationNumber: z.string().trim().min(1).max(20),
    vehicleType,
    capacityValue: z.coerce.number().finite("Capacity must be a finite number.").positive("Capacity must be greater than zero."),
    capacityUnit: quantityUnit.default("KG"),
    capabilities: z.array(vehicleCapability).max(10).optional(),
    isRefrigerated: z.boolean().optional(),
  })
  .strict();

export const bulkRegisterVehiclesBody = z
  .object({
    vehicles: z.array(bulkVehicleItem).min(1, "At least one vehicle is required.").max(50, "A batch cannot exceed 50 vehicles."),
  })
  .strict();

export const updateVehicleBody = z
  .object({
    vehicleType: vehicleType.optional(),
    capacityValue: z.coerce.number().finite().positive().optional(),
    capacityUnit: quantityUnit.optional(),
    capabilities: z.array(vehicleCapability).max(10).optional(),
    isRefrigerated: z.boolean().optional(),
  })
  .strict();

export const updateAvailabilityBody = z
  .object({
    // Only the two owner-settable values are accepted at the schema level
    // (Part G) — RESERVED/IN_TRANSIT are rejected before this even reaches
    // the service layer.
    availabilityStatus: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  })
  .strict();

export const updateStatusBody = z
  .object({
    status: vehicleStatus,
  })
  .strict();

export const listMyVehiclesQuery = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export const adminVehicleVerificationBody = z
  .object({
    status: vehicleVerificationStatus,
  })
  .strict();
