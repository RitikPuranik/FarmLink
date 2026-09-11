import { LogisticsRequestStatus, PrismaClient, QuantityUnit, VehicleCapability } from "@prisma/client";
import { LogisticsRequestRecord } from "./logistics.types";

export interface CreateLogisticsRequestData {
  lotId: string;
  requesterUserId: string;
  cropId: string;
  requiredQuantityKg: number;
  quantityUnit: QuantityUnit;
  pickupAddress?: string | null;
  pickupVillage?: string | null;
  pickupDistrict: string;
  pickupState: string;
  pickupPincode?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  destinationAddress?: string | null;
  destinationDistrict: string;
  destinationState: string;
  destinationPincode?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  requestedPickupAt?: Date | null;
  deliveryDeadline?: Date | null;
  requiredCapabilities: VehicleCapability[];
  requiresRefrigeration: boolean;
  specialInstructions?: string | null;
}

export interface UpdateLogisticsRequestData {
  pickupAddress?: string | null;
  pickupVillage?: string | null;
  pickupDistrict?: string;
  pickupState?: string;
  pickupPincode?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  destinationAddress?: string | null;
  destinationDistrict?: string;
  destinationState?: string;
  destinationPincode?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  requestedPickupAt?: Date | null;
  deliveryDeadline?: Date | null;
  requiredCapabilities?: VehicleCapability[];
  requiresRefrigeration?: boolean;
  specialInstructions?: string | null;
}

export interface EstimateData {
  estimatedDistanceKm: number;
  estimatedDurationMinutes: number;
  estimatedCost: number;
  estimatedCostCurrency: string;
}

export interface LogisticsRequestListFilters {
  requesterUserId?: string;
  status?: LogisticsRequestStatus;
  cropId?: string;
  page: number;
  limit: number;
}

export interface LogisticsRequestPage {
  items: LogisticsRequestRecord[];
  total: number;
}

/**
 * Data-access boundary for LogisticsRequest. Ownership/authorization is
 * never decided here (see logistics.authorization.ts) — same convention
 * as VehicleRepository in Module 15.
 */
export interface LogisticsRequestRepository {
  create(data: CreateLogisticsRequestData): Promise<LogisticsRequestRecord>;
  findById(id: string): Promise<LogisticsRequestRecord | null>;
  findByPublicId(publicId: string): Promise<LogisticsRequestRecord | null>;
  list(filters: LogisticsRequestListFilters): Promise<LogisticsRequestPage>;
  update(id: string, data: UpdateLogisticsRequestData): Promise<LogisticsRequestRecord>;
  applyEstimate(id: string, data: EstimateData): Promise<LogisticsRequestRecord>;
  setRecommendedQuote(id: string, recommendedQuoteId: string | null): Promise<LogisticsRequestRecord>;
  /** Atomic conditional transition — mirrors CropLotRepository.transition()
   * (returns null on 0 rows updated instead of throwing, so the caller can
   * distinguish "not found" from "not in an eligible fromStatus" without a
   * second read). */
  transition(
    id: string,
    fromStatuses: LogisticsRequestStatus[],
    toStatus: LogisticsRequestStatus,
    extra?: { cancelledAt?: Date; cancelReason?: string | null; acceptedQuoteId?: string },
  ): Promise<LogisticsRequestRecord | null>;
}

export class PrismaLogisticsRequestRepository implements LogisticsRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreateLogisticsRequestData) {
    return this.prisma.logisticsRequest.create({
      data: {
        lotId: data.lotId,
        requesterUserId: data.requesterUserId,
        cropId: data.cropId,
        requiredQuantityKg: data.requiredQuantityKg,
        quantityUnit: data.quantityUnit,
        pickupAddress: data.pickupAddress ?? null,
        pickupVillage: data.pickupVillage ?? null,
        pickupDistrict: data.pickupDistrict,
        pickupState: data.pickupState,
        pickupPincode: data.pickupPincode ?? null,
        pickupLatitude: data.pickupLatitude ?? null,
        pickupLongitude: data.pickupLongitude ?? null,
        destinationAddress: data.destinationAddress ?? null,
        destinationDistrict: data.destinationDistrict,
        destinationState: data.destinationState,
        destinationPincode: data.destinationPincode ?? null,
        destinationLatitude: data.destinationLatitude ?? null,
        destinationLongitude: data.destinationLongitude ?? null,
        requestedPickupAt: data.requestedPickupAt ?? null,
        deliveryDeadline: data.deliveryDeadline ?? null,
        requiredCapabilities: data.requiredCapabilities,
        requiresRefrigeration: data.requiresRefrigeration,
        specialInstructions: data.specialInstructions ?? null,
        status: "OPEN",
      },
    });
  }

  findById(id: string) {
    return this.prisma.logisticsRequest.findUnique({ where: { id } });
  }

  findByPublicId(publicId: string) {
    return this.prisma.logisticsRequest.findUnique({ where: { publicId } });
  }

  async list(filters: LogisticsRequestListFilters): Promise<LogisticsRequestPage> {
    const where = {
      ...(filters.requesterUserId ? { requesterUserId: filters.requesterUserId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.cropId ? { cropId: filters.cropId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.logisticsRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.logisticsRequest.count({ where }),
    ]);
    return { items, total };
  }

  update(id: string, data: UpdateLogisticsRequestData) {
    return this.prisma.logisticsRequest.update({
      where: { id },
      data: {
        ...(data.pickupAddress !== undefined ? { pickupAddress: data.pickupAddress } : {}),
        ...(data.pickupVillage !== undefined ? { pickupVillage: data.pickupVillage } : {}),
        ...(data.pickupDistrict !== undefined ? { pickupDistrict: data.pickupDistrict } : {}),
        ...(data.pickupState !== undefined ? { pickupState: data.pickupState } : {}),
        ...(data.pickupPincode !== undefined ? { pickupPincode: data.pickupPincode } : {}),
        ...(data.pickupLatitude !== undefined ? { pickupLatitude: data.pickupLatitude } : {}),
        ...(data.pickupLongitude !== undefined ? { pickupLongitude: data.pickupLongitude } : {}),
        ...(data.destinationAddress !== undefined ? { destinationAddress: data.destinationAddress } : {}),
        ...(data.destinationDistrict !== undefined ? { destinationDistrict: data.destinationDistrict } : {}),
        ...(data.destinationState !== undefined ? { destinationState: data.destinationState } : {}),
        ...(data.destinationPincode !== undefined ? { destinationPincode: data.destinationPincode } : {}),
        ...(data.destinationLatitude !== undefined ? { destinationLatitude: data.destinationLatitude } : {}),
        ...(data.destinationLongitude !== undefined ? { destinationLongitude: data.destinationLongitude } : {}),
        ...(data.requestedPickupAt !== undefined ? { requestedPickupAt: data.requestedPickupAt } : {}),
        ...(data.deliveryDeadline !== undefined ? { deliveryDeadline: data.deliveryDeadline } : {}),
        ...(data.requiredCapabilities !== undefined ? { requiredCapabilities: data.requiredCapabilities } : {}),
        ...(data.requiresRefrigeration !== undefined ? { requiresRefrigeration: data.requiresRefrigeration } : {}),
        ...(data.specialInstructions !== undefined ? { specialInstructions: data.specialInstructions } : {}),
        // Any manual edit to pickup/destination/requirements invalidates
        // the previous estimate — never leave a stale estimate attached to
        // a materially different request (Step 12's numbers must reflect
        // *this* request).
        estimatedDistanceKm: null,
        estimatedDurationMinutes: null,
        estimatedCost: null,
        estimateCalculatedAt: null,
      },
    });
  }

  applyEstimate(id: string, data: EstimateData) {
    return this.prisma.logisticsRequest.update({
      where: { id },
      data: {
        estimatedDistanceKm: data.estimatedDistanceKm,
        estimatedDurationMinutes: Math.round(data.estimatedDurationMinutes),
        estimatedCost: data.estimatedCost,
        estimatedCostCurrency: data.estimatedCostCurrency,
        estimateCalculatedAt: new Date(),
      },
    });
  }

  setRecommendedQuote(id: string, recommendedQuoteId: string | null) {
    return this.prisma.logisticsRequest.update({ where: { id }, data: { recommendedQuoteId } });
  }

  async transition(
    id: string,
    fromStatuses: LogisticsRequestStatus[],
    toStatus: LogisticsRequestStatus,
    extra?: { cancelledAt?: Date; cancelReason?: string | null; acceptedQuoteId?: string },
  ): Promise<LogisticsRequestRecord | null> {
    const result = await this.prisma.logisticsRequest.updateMany({
      where: { id, status: { in: fromStatuses } },
      data: {
        status: toStatus,
        ...(extra?.cancelledAt !== undefined ? { cancelledAt: extra.cancelledAt } : {}),
        ...(extra?.cancelReason !== undefined ? { cancelReason: extra.cancelReason } : {}),
        ...(extra?.acceptedQuoteId !== undefined ? { acceptedQuoteId: extra.acceptedQuoteId } : {}),
      },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }
}
