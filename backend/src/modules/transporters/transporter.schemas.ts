import { z } from "zod";

const publicId = z.string().uuid("This value is not valid.");
const areaType = z.enum(["STATE", "DISTRICT", "CITY", "PINCODE"]);
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
const availabilityStatus = z.enum(["AVAILABLE", "UNAVAILABLE"]);
const transporterVerificationStatus = z.enum(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]);
const transportProviderType = z.enum(["INDIVIDUAL", "BUSINESS", "COMPANY", "COOPERATIVE", "LOGISTICS_PROVIDER"]);

export const transporterPublicIdParams = z.object({ publicId });

export const createTransporterProfileBody = z
  .object({
    providerType: transportProviderType.optional(),
    businessName: z.string().trim().min(1).max(160).optional(),
    legalName: z.string().trim().min(1).max(200).optional(),
    contactName: z.string().trim().min(1).max(120).optional(),
    contactPhone: z.string().trim().min(6).max(20).optional(),
    contactEmail: z.string().trim().email("Enter a valid email address.").optional(),
  })
  .strict();

export const updateTransporterProfileBody = createTransporterProfileBody;

export const addServiceAreaBody = z
  .object({
    areaType,
    state: z.string().trim().min(1).max(80).optional(),
    district: z.string().trim().min(1).max(80).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    pincode: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/, "Enter a valid 6-digit pincode.")
      .optional(),
  })
  .strict();

export const serviceAreaIdParams = z.object({ id: z.string().uuid("This value is not valid.") });

/** z.coerce.boolean() would treat the literal string "false" as truthy
 * (it just checks non-empty-string) — the controller parses "true"/"false"
 * explicitly instead of relying on a schema-level transform. */
const booleanQueryParam = z.enum(["true", "false"]).optional();

export const listTransportersQuery = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    state: z.string().trim().min(1).max(80).optional(),
    district: z.string().trim().min(1).max(80).optional(),
    providerType: transportProviderType.optional(),
    vehicleType: vehicleType.optional(),
    minimumCapacity: z.coerce.number().finite().positive().optional(),
    minimumCapacityUnit: z.enum(["KG", "QTL", "TONNE"]).default("KG"),
    refrigerated: booleanQueryParam,
    availability: availabilityStatus.optional(),
    verified: booleanQueryParam,
  })
  .strict();

export const adminVerificationBody = z
  .object({
    status: transporterVerificationStatus,
  })
  .strict();
