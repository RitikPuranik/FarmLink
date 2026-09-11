import { z } from "zod";

const publicId = z.string().uuid("This value is not valid.");
const quantityUnit = z.enum(["KG", "QTL", "TONNE"]);
const vehicleCapability = z.enum([
  "COVERED",
  "OPEN_BODY",
  "TEMPERATURE_CONTROLLED",
  "BULK_TRANSPORT",
  "SMALL_LOAD_SUITABLE",
  "LARGE_LOAD_SUITABLE",
]);
const logisticsRequestStatus = z.enum(["OPEN", "QUOTE_ACCEPTED", "CANCELLED"]);
const logisticsQuoteStatus = z.enum(["DRAFT", "SUBMITTED", "EXPIRED", "WITHDRAWN", "ACCEPTED", "REJECTED"]);

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);

const locationInput = z.object({
  address: z.string().trim().max(255).optional(),
  district: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(120),
  pincode: z.string().trim().max(10).optional(),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
});

export const logisticsRequestPublicIdParams = z.object({ publicId }).strict();
export const logisticsQuotePublicIdParams = z.object({ publicId }).strict();

export const createLogisticsRequestBody = z
  .object({
    lotId: publicId,
    requiredQuantityValue: z.coerce.number().finite("Quantity must be a finite number.").positive("Quantity must be greater than zero."),
    requiredQuantityUnit: quantityUnit.default("KG"),
    // Pickup is optional — defaults to the lot's own registered origin
    // (originDistrict/originState) when omitted, see
    // logistics-request.service.ts's own comment. When provided, district
    // and state are still required (an override must be a real location,
    // never a partial one).
    pickup: locationInput.partial({ district: true, state: true }).optional(),
    destination: locationInput,
    requestedPickupAt: z.coerce.date().optional(),
    deliveryDeadline: z.coerce.date().optional(),
    requiredCapabilities: z.array(vehicleCapability).max(10).optional(),
    requiresRefrigeration: z.boolean().optional(),
    specialInstructions: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((data) => !data.requestedPickupAt || !data.deliveryDeadline || data.requestedPickupAt <= data.deliveryDeadline, {
    message: "Delivery deadline must be on or after the requested pickup time.",
    path: ["deliveryDeadline"],
  });

export const updateLogisticsRequestBody = z
  .object({
    pickup: locationInput.optional(),
    destination: locationInput.optional(),
    requestedPickupAt: z.coerce.date().optional(),
    deliveryDeadline: z.coerce.date().optional(),
    requiredCapabilities: z.array(vehicleCapability).max(10).optional(),
    requiresRefrigeration: z.boolean().optional(),
    specialInstructions: z.string().trim().max(1000).optional(),
  })
  .strict();

export const cancelLogisticsRequestBody = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const listLogisticsRequestsQuery = z
  .object({
    status: logisticsRequestStatus.optional(),
    cropId: publicId.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export const submitLogisticsQuoteBody = z
  .object({
    vehicleId: publicId,
    quotedAmount: z.coerce.number().finite("Quoted amount must be a finite number.").positive("Quoted amount must be greater than zero."),
    currency: z.string().trim().length(3).default("INR"),
    estimatedPickupTime: z.coerce.date().optional(),
    estimatedDeliveryTime: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).optional(),
    validUntil: z.coerce.date().optional(),
  })
  .strict()
  .refine(
    (data) => !data.estimatedPickupTime || !data.estimatedDeliveryTime || data.estimatedPickupTime <= data.estimatedDeliveryTime,
    { message: "Estimated delivery time must be on or after the estimated pickup time.", path: ["estimatedDeliveryTime"] },
  );

export const updateLogisticsQuoteBody = z
  .object({
    quotedAmount: z.coerce.number().finite().positive().optional(),
    estimatedPickupTime: z.coerce.date().optional(),
    estimatedDeliveryTime: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).optional(),
    validUntil: z.coerce.date().optional(),
  })
  .strict();

export const listLogisticsQuotesQuery = z
  .object({
    status: logisticsQuoteStatus.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

export const listMyLogisticsQuotesQuery = z
  .object({
    status: logisticsQuoteStatus.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();
