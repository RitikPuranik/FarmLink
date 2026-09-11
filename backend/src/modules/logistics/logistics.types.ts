import { LogisticsQuoteStatus, LogisticsRequestStatus, QuantityUnit, VehicleCapability } from "@prisma/client";

/**
 * Raw Prisma row shapes (as returned by logistics-request.repository.ts /
 * logistics-quote.repository.ts) and the public DTOs mapped from them.
 * publicId is the only identity ever exposed over the API (Step 6: "Do not
 * expose internal numeric/database IDs unnecessarily").
 */

export interface LogisticsRequestRecord {
  id: string;
  publicId: string;
  lotId: string;
  requesterUserId: string;
  cropId: string;
  requiredQuantityKg: unknown; // Prisma.Decimal at runtime
  quantityUnit: QuantityUnit;
  pickupAddress: string | null;
  pickupVillage: string | null;
  pickupDistrict: string;
  pickupState: string;
  pickupPincode: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  destinationAddress: string | null;
  destinationDistrict: string;
  destinationState: string;
  destinationPincode: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  requestedPickupAt: Date | null;
  deliveryDeadline: Date | null;
  requiredCapabilities: VehicleCapability[];
  requiresRefrigeration: boolean;
  specialInstructions: string | null;
  status: LogisticsRequestStatus;
  estimatedDistanceKm: unknown | null;
  estimatedDurationMinutes: number | null;
  estimatedCost: unknown | null;
  estimatedCostCurrency: string;
  estimateCalculatedAt: Date | null;
  recommendedQuoteId: string | null;
  acceptedQuoteId: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LogisticsQuoteRecord {
  id: string;
  publicId: string;
  logisticsRequestId: string;
  transportProviderId: string;
  vehicleId: string;
  quotedAmount: unknown; // Prisma.Decimal at runtime
  currency: string;
  estimatedPickupTime: Date | null;
  estimatedDeliveryTime: Date | null;
  estimatedDistanceKm: unknown | null;
  estimatedDurationMinutes: number | null;
  notes: string | null;
  status: LogisticsQuoteStatus;
  validUntil: Date | null;
  submittedAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  withdrawnAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value);
}

export interface LogisticsRequestPublicDTO {
  requestId: string;
  lotId: string;
  crop: { cropId: string };
  requiredQuantity: { value: number; unit: QuantityUnit };
  pickup: {
    address: string | null;
    village: string | null;
    district: string;
    state: string;
    pincode: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  destination: {
    address: string | null;
    district: string;
    state: string;
    pincode: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  requestedPickupAt: string | null;
  deliveryDeadline: string | null;
  requiredCapabilities: VehicleCapability[];
  requiresRefrigeration: boolean;
  specialInstructions: string | null;
  status: LogisticsRequestStatus;
  estimate: {
    distanceKm: number | null;
    durationMinutes: number | null;
    cost: number | null;
    currency: string;
    calculatedAt: string | null;
  };
  recommendedQuoteId: string | null;
  acceptedQuoteId: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toLogisticsRequestPublicDTO(
  row: LogisticsRequestRecord,
  quotePublicIdsById: Map<string, string>,
): LogisticsRequestPublicDTO {
  return {
    requestId: row.publicId,
    lotId: row.lotId,
    crop: { cropId: row.cropId },
    requiredQuantity: { value: toNumber(row.requiredQuantityKg), unit: row.quantityUnit },
    pickup: {
      address: row.pickupAddress,
      village: row.pickupVillage,
      district: row.pickupDistrict,
      state: row.pickupState,
      pincode: row.pickupPincode,
      latitude: row.pickupLatitude,
      longitude: row.pickupLongitude,
    },
    destination: {
      address: row.destinationAddress,
      district: row.destinationDistrict,
      state: row.destinationState,
      pincode: row.destinationPincode,
      latitude: row.destinationLatitude,
      longitude: row.destinationLongitude,
    },
    requestedPickupAt: row.requestedPickupAt ? row.requestedPickupAt.toISOString() : null,
    deliveryDeadline: row.deliveryDeadline ? row.deliveryDeadline.toISOString() : null,
    requiredCapabilities: row.requiredCapabilities,
    requiresRefrigeration: row.requiresRefrigeration,
    specialInstructions: row.specialInstructions,
    status: row.status,
    estimate: {
      distanceKm: toNullableNumber(row.estimatedDistanceKm),
      durationMinutes: row.estimatedDurationMinutes,
      cost: toNullableNumber(row.estimatedCost),
      currency: row.estimatedCostCurrency,
      calculatedAt: row.estimateCalculatedAt ? row.estimateCalculatedAt.toISOString() : null,
    },
    recommendedQuoteId: row.recommendedQuoteId ? (quotePublicIdsById.get(row.recommendedQuoteId) ?? null) : null,
    acceptedQuoteId: row.acceptedQuoteId ? (quotePublicIdsById.get(row.acceptedQuoteId) ?? null) : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface LogisticsQuotePublicDTO {
  quoteId: string;
  requestId: string;
  transportProviderId: string;
  vehicleId: string;
  quotedAmount: number;
  currency: string;
  estimatedPickupTime: string | null;
  estimatedDeliveryTime: string | null;
  estimatedDistanceKm: number | null;
  estimatedDurationMinutes: number | null;
  notes: string | null;
  status: LogisticsQuoteStatus;
  validUntil: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toLogisticsQuotePublicDTO(
  row: LogisticsQuoteRecord,
  requestPublicId: string,
  transportProviderPublicId: string,
  vehiclePublicId: string,
): LogisticsQuotePublicDTO {
  return {
    quoteId: row.publicId,
    requestId: requestPublicId,
    transportProviderId: transportProviderPublicId,
    vehicleId: vehiclePublicId,
    quotedAmount: toNumber(row.quotedAmount),
    currency: row.currency,
    estimatedPickupTime: row.estimatedPickupTime ? row.estimatedPickupTime.toISOString() : null,
    estimatedDeliveryTime: row.estimatedDeliveryTime ? row.estimatedDeliveryTime.toISOString() : null,
    estimatedDistanceKm: toNullableNumber(row.estimatedDistanceKm),
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    notes: row.notes,
    status: row.status,
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { toNumber as decimalToNumber, toNullableNumber as nullableDecimalToNumber };
