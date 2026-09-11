import { LogisticsRequestStatus, QuantityUnit, VehicleCapability } from "@prisma/client";
import { AuthorizationError, LogisticsDomainError, NotFoundError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { CropLotRepository } from "../lots/lots.repository";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { LogisticsAuthorizationService } from "./logistics.authorization";
import { LogisticsCostEstimator } from "./logistics-cost-estimator";
import { GeoPoint, RouteDistanceProvider } from "./route-distance.provider";
import { CreateLogisticsRequestData, LogisticsRequestRepository } from "./logistics-request.repository";
import { LogisticsQuoteRepository } from "./logistics-quote.repository";
import { LogisticsVehicleDiscoveryRepository } from "./logistics-vehicle-discovery.repository";
import { VehicleEligibilityService, EligibilityReason } from "./vehicle-eligibility.service";
import { convertQuantityToKg } from "../fpo/unit-conversion";
import { costCacheKey, getCached, routeCacheKey, setCachedCost, setCachedRoute } from "./logistics-cache";
import { LOGISTICS_ALGORITHM_VERSION, getCostConfig, getOptimizationWeights, getRouteConfig } from "./logistics.config";
import { LogisticsOptimizationEngine, OptimizationCandidate } from "./logistics-optimization.engine";
import { LogisticsOptimizationResultRepository } from "./logistics-optimization-result.repository";
import { ProviderReliabilityService } from "./provider-reliability.service";
import { VehicleRepository } from "../transporters/vehicle.repository";
import { TransporterRepository } from "../transporters/transporter.repository";
import {
  LogisticsRequestPublicDTO,
  LogisticsRequestRecord,
  decimalToNumber,
  nullableDecimalToNumber,
  toLogisticsRequestPublicDTO,
} from "./logistics.types";

export interface LocationInput {
  address?: string;
  village?: string;
  district?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
}

export interface CreateLogisticsRequestInput {
  lotId: string;
  requiredQuantityValue: number;
  requiredQuantityUnit: QuantityUnit;
  pickup?: LocationInput;
  destination: LocationInput;
  requestedPickupAt?: Date;
  deliveryDeadline?: Date;
  requiredCapabilities?: VehicleCapability[];
  requiresRefrigeration?: boolean;
  specialInstructions?: string;
}

export interface UpdateLogisticsRequestInput {
  pickup?: LocationInput;
  destination?: LocationInput;
  requestedPickupAt?: Date;
  deliveryDeadline?: Date;
  requiredCapabilities?: VehicleCapability[];
  requiresRefrigeration?: boolean;
  specialInstructions?: string;
}

export interface ListLogisticsRequestsInput {
  status?: LogisticsRequestStatus;
  cropId?: string;
  page: number;
  limit: number;
}

export interface CalculateEstimateResult {
  estimatedDistanceKm: number;
  estimatedDurationMinutes: number;
  estimatedCost: number;
  currency: string;
  isEstimated: true;
  suitableVehicleCount: number;
}

export interface AvailableProviderEntry {
  transportProviderId: string;
  transporterBusinessName: string | null;
  vehicleId: string;
  vehicleType: string;
  capacityKg: number;
  eligible: boolean;
  reasons: EligibilityReason[];
}

export interface OptimizeRequestResult {
  algorithmVersion: string;
  calculatedAt: string;
  recommended: {
    quoteId: string;
    score: number;
    transportProviderId: string;
    vehicleId: string;
    quotedAmount: number;
    currency: string;
    estimatedDistanceKm: number | null;
    estimatedDurationMinutes: number | null;
    reasons: string[];
  } | null;
  alternatives: Array<{
    rank: number;
    quoteId: string;
    score: number;
    reasons: string[];
  }>;
}

/**
 * Step 6/9/11/12/13 — orchestrates LogisticsRequest creation, estimation,
 * eligible-vehicle discovery, and optimization. Every deterministic
 * calculation is delegated to a dedicated collaborator (RouteDistanceProvider,
 * LogisticsCostEstimator, VehicleEligibilityService, LogisticsOptimizationEngine)
 * — this service only orchestrates + persists + authorizes, exactly the
 * "keep the optimization engine independent from HTTP controllers" split
 * the build spec's architecture diagram calls for.
 */
export class LogisticsRequestService {
  constructor(
    private readonly requests: LogisticsRequestRepository,
    private readonly quotes: LogisticsQuoteRepository,
    private readonly cropLots: CropLotRepository,
    private readonly farmerProfiles: FarmerProfileResolver,
    private readonly authorization: LogisticsAuthorizationService,
    private readonly routeDistanceProvider: RouteDistanceProvider,
    private readonly costEstimator: LogisticsCostEstimator,
    private readonly vehicleDiscovery: LogisticsVehicleDiscoveryRepository,
    private readonly vehicleEligibility: VehicleEligibilityService,
    private readonly vehicles: VehicleRepository,
    private readonly transporters: TransporterRepository,
    private readonly reliability: ProviderReliabilityService,
    private readonly optimizationEngine: LogisticsOptimizationEngine,
    private readonly optimizationResults: LogisticsOptimizationResultRepository,
    private readonly audit: AuditService,
  ) {}

  private async resolveCallerFarmerProfileId(user: AuthenticatedUserContext): Promise<string | null> {
    if (user.role !== "FARMER") return null;
    return (await this.farmerProfiles.ensure(user.id)).id;
  }

  private async loadRequestOrThrow(publicId: string): Promise<LogisticsRequestRecord> {
    const request = await this.requests.findByPublicId(publicId);
    if (!request) throw new NotFoundError("Logistics request not found.");
    return request;
  }

  async createRequest(
    user: AuthenticatedUserContext,
    input: CreateLogisticsRequestInput,
    meta?: RequestMeta,
  ): Promise<LogisticsRequestPublicDTO> {
    const lot = await this.cropLots.findByPublicId(input.lotId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const callerFarmerProfileId = await this.resolveCallerFarmerProfileId(user);
    const canCreate = await this.authorization.canCreateForLot(
      user,
      { ownerType: lot.ownerType, farmerId: lot.farmerId, fpoId: lot.fpoId },
      callerFarmerProfileId,
    );
    if (!canCreate) {
      throw new AuthorizationError("You do not have permission to raise a logistics request for this lot.");
    }

    const requiredQuantityKg = convertQuantityToKg(input.requiredQuantityValue, input.requiredQuantityUnit);
    const availableQuantityKg = decimalToNumber(lot.availableQuantityKg);
    if (requiredQuantityKg > availableQuantityKg) {
      throw new LogisticsDomainError(
        "The requested transport quantity exceeds the lot's available quantity.",
        "INVALID_LOGISTICS_REQUEST",
      );
    }

    const pickup = input.pickup ?? {};
    const data: CreateLogisticsRequestData = {
      lotId: lot.id,
      requesterUserId: user.id,
      cropId: lot.cropId,
      requiredQuantityKg,
      quantityUnit: input.requiredQuantityUnit,
      pickupAddress: pickup.address ?? null,
      pickupVillage: pickup.village ?? lot.originVillage ?? null,
      pickupDistrict: pickup.district ?? lot.originDistrict,
      pickupState: pickup.state ?? lot.originState,
      pickupPincode: pickup.pincode ?? null,
      pickupLatitude: pickup.latitude ?? null,
      pickupLongitude: pickup.longitude ?? null,
      destinationAddress: input.destination.address ?? null,
      destinationDistrict: input.destination.district!,
      destinationState: input.destination.state!,
      destinationPincode: input.destination.pincode ?? null,
      destinationLatitude: input.destination.latitude ?? null,
      destinationLongitude: input.destination.longitude ?? null,
      requestedPickupAt: input.requestedPickupAt ?? null,
      deliveryDeadline: input.deliveryDeadline ?? null,
      requiredCapabilities: input.requiredCapabilities ?? [],
      requiresRefrigeration: input.requiresRefrigeration ?? false,
      specialInstructions: input.specialInstructions ?? null,
    };

    const created = await this.requests.create(data);

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_REQUEST_CREATED",
      entityType: "LogisticsRequest",
      entityId: created.id,
      metadata: { lotId: lot.publicId, requiredQuantityKg },
      ...meta,
    });
    trackEvent("logistics_request_created", user.id, { requiredQuantityKg });

    return await this.toDTO(created);
  }

  async getRequest(user: AuthenticatedUserContext, publicId: string): Promise<LogisticsRequestPublicDTO> {
    const request = await this.loadRequestOrThrow(publicId);
    await this.assertCanView(user, request);
    return await this.toDTO(request);
  }

  private async assertCanView(user: AuthenticatedUserContext, request: LogisticsRequestRecord): Promise<void> {
    if (user.role === "TRANSPORTER") {
      const transporter = await this.transporters.findByUserId(user.id);
      const hasOwnQuote = transporter
        ? (await this.quotes.list({ logisticsRequestId: request.id, transportProviderId: transporter.id, page: 1, limit: 1 })).total > 0
        : false;
      if (!this.authorization.canViewAsTransporter(request, hasOwnQuote)) {
        throw new AuthorizationError("This logistics request is not visible to you.");
      }
      return;
    }

    const lot = await this.cropLots.findById(request.lotId);
    if (!lot) throw new NotFoundError("Lot not found.");
    const callerFarmerProfileId = await this.resolveCallerFarmerProfileId(user);
    const canManage = await this.authorization.canManageRequest(
      user,
      request,
      { ownerType: lot.ownerType, farmerId: lot.farmerId, fpoId: lot.fpoId },
      callerFarmerProfileId,
    );
    if (!canManage) throw new AuthorizationError("You do not have permission to view this logistics request.");
  }

  private async assertCanManage(user: AuthenticatedUserContext, request: LogisticsRequestRecord): Promise<void> {
    const lot = await this.cropLots.findById(request.lotId);
    if (!lot) throw new NotFoundError("Lot not found.");
    const callerFarmerProfileId = await this.resolveCallerFarmerProfileId(user);
    const canManage = await this.authorization.canManageRequest(
      user,
      request,
      { ownerType: lot.ownerType, farmerId: lot.farmerId, fpoId: lot.fpoId },
      callerFarmerProfileId,
    );
    this.authorization.assertCanDecide(user, request, canManage);
  }

  /** Step 6/7 — FARMER/FPO_ADMIN see only their own requests; ADMIN sees
   * everything; TRANSPORTER sees every currently-OPEN request regardless
   * of who raised it (there is no dedicated "requests I can quote on"
   * route in the build spec's own route list — this is the pragmatic
   * discovery surface a provider needs before Step 7's
   * POST .../quotes makes sense to call at all). A TRANSPORTER's own
   * `status` filter is therefore ignored — they may only ever browse OPEN
   * requests here. */
  async listRequests(user: AuthenticatedUserContext, input: ListLogisticsRequestsInput) {
    let requesterUserId: string | undefined;
    let status = input.status;
    if (user.role === "ADMIN") {
      requesterUserId = undefined;
    } else if (user.role === "TRANSPORTER") {
      requesterUserId = undefined;
      status = "OPEN" as LogisticsRequestStatus;
    } else {
      requesterUserId = user.id;
    }

    const page = await this.requests.list({
      requesterUserId,
      status,
      cropId: input.cropId,
      page: input.page,
      limit: input.limit,
    });
    return {
      items: await Promise.all(page.items.map((row) => this.toDTO(row))),
      total: page.total,
      page: input.page,
      limit: input.limit,
    };
  }

  async updateRequest(
    user: AuthenticatedUserContext,
    publicId: string,
    input: UpdateLogisticsRequestInput,
    meta?: RequestMeta,
  ): Promise<LogisticsRequestPublicDTO> {
    const request = await this.loadRequestOrThrow(publicId);
    await this.assertCanManage(user, request);

    if (request.status !== "OPEN") {
      throw new LogisticsDomainError("Only an open logistics request can be updated.", "LOGISTICS_REQUEST_NOT_OPEN");
    }

    const updated = await this.requests.update(request.id, {
      ...(input.pickup
        ? {
            pickupAddress: input.pickup.address ?? null,
            pickupVillage: input.pickup.village ?? null,
            pickupDistrict: input.pickup.district,
            pickupState: input.pickup.state,
            pickupPincode: input.pickup.pincode ?? null,
            pickupLatitude: input.pickup.latitude ?? null,
            pickupLongitude: input.pickup.longitude ?? null,
          }
        : {}),
      ...(input.destination
        ? {
            destinationAddress: input.destination.address ?? null,
            destinationDistrict: input.destination.district,
            destinationState: input.destination.state,
            destinationPincode: input.destination.pincode ?? null,
            destinationLatitude: input.destination.latitude ?? null,
            destinationLongitude: input.destination.longitude ?? null,
          }
        : {}),
      requestedPickupAt: input.requestedPickupAt,
      deliveryDeadline: input.deliveryDeadline,
      requiredCapabilities: input.requiredCapabilities,
      requiresRefrigeration: input.requiresRefrigeration,
      specialInstructions: input.specialInstructions,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_REQUEST_UPDATED",
      entityType: "LogisticsRequest",
      entityId: request.id,
      ...meta,
    });

    return await this.toDTO(updated);
  }

  async cancelRequest(
    user: AuthenticatedUserContext,
    publicId: string,
    reason: string | undefined,
    meta?: RequestMeta,
  ): Promise<LogisticsRequestPublicDTO> {
    const request = await this.loadRequestOrThrow(publicId);
    await this.assertCanManage(user, request);

    if (request.status === "CANCELLED") {
      throw new LogisticsDomainError("This logistics request has already been cancelled.", "LOGISTICS_REQUEST_ALREADY_CANCELLED");
    }

    const updated = await this.requests.transition(request.id, ["OPEN"], "CANCELLED", {
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    });
    if (!updated) {
      throw new LogisticsDomainError(
        "Only an open logistics request can be cancelled — this one already has an accepted quote.",
        "LOGISTICS_REQUEST_NOT_OPEN",
      );
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_REQUEST_CANCELLED",
      entityType: "LogisticsRequest",
      entityId: request.id,
      metadata: { reason: reason ?? null },
      ...meta,
    });

    return await this.toDTO(updated);
  }

  /** Step 12 — callable at any time while the request is not cancelled, so
   * a farmer can see a rough number before any provider has quoted. */
  async calculateEstimate(user: AuthenticatedUserContext, publicId: string, meta?: RequestMeta): Promise<CalculateEstimateResult> {
    const request = await this.loadRequestOrThrow(publicId);
    await this.assertCanManage(user, request);

    if (request.status === "CANCELLED") {
      throw new LogisticsDomainError("A cancelled logistics request cannot be estimated.", "LOGISTICS_REQUEST_NOT_OPEN");
    }

    if (
      request.pickupLatitude === null ||
      request.pickupLongitude === null ||
      request.destinationLatitude === null ||
      request.destinationLongitude === null
    ) {
      throw new LogisticsDomainError(
        "Pickup and destination coordinates are required to calculate a distance-based estimate. Update the request with latitude/longitude first.",
        "INVALID_LOGISTICS_REQUEST",
      );
    }

    const origin: GeoPoint = { latitude: request.pickupLatitude, longitude: request.pickupLongitude };
    const destination: GeoPoint = { latitude: request.destinationLatitude, longitude: request.destinationLongitude };

    const routeKey = routeCacheKey(origin, destination);
    let route = await getCached<{ distanceKm: number; durationMinutes: number }>(routeKey);
    if (!route) {
      const computed = await this.routeDistanceProvider.estimateRoute(origin, destination);
      route = { distanceKm: computed.distanceKm, durationMinutes: computed.durationMinutes };
      await setCachedRoute(routeKey, route);
    }

    const costKey = costCacheKey(routeKey, request.requiresRefrigeration ? "refrigerated" : "standard", LOGISTICS_ALGORITHM_VERSION);
    let cost = await getCached<{ totalCost: number; currency: string }>(costKey);
    if (!cost) {
      const breakdown = this.costEstimator.estimate({
        distanceKm: route.distanceKm,
        requiresRefrigeration: request.requiresRefrigeration,
      });
      cost = { totalCost: breakdown.totalCost, currency: breakdown.currency };
      await setCachedCost(costKey, cost);
    }

    const requiredQuantityKg = decimalToNumber(request.requiredQuantityKg);
    const candidates = await this.vehicleDiscovery.findCandidates({ minimumCapacityKg: requiredQuantityKg });
    let suitableVehicleCount = 0;
    for (const candidate of candidates) {
      const result = this.vehicleEligibility.evaluate(
        {
          id: candidate.vehicleId,
          status: candidate.status as never,
          verificationStatus: candidate.verificationStatus as never,
          availabilityStatus: candidate.availabilityStatus as never,
          capacityKg: candidate.capacityKg,
          capabilities: candidate.capabilities,
          isRefrigerated: candidate.isRefrigerated,
        },
        {
          id: candidate.transporterId,
          isActive: candidate.transporterIsActive,
          verificationStatus: candidate.transporterVerificationStatus as never,
        },
        {
          requiredCapacityKg: requiredQuantityKg,
          requiresRefrigeration: request.requiresRefrigeration,
          requiredCapabilities: request.requiredCapabilities,
        },
      );
      if (result.eligible) suitableVehicleCount += 1;
    }

    await this.requests.applyEstimate(request.id, {
      estimatedDistanceKm: route.distanceKm,
      estimatedDurationMinutes: route.durationMinutes,
      estimatedCost: cost.totalCost,
      estimatedCostCurrency: cost.currency,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_ESTIMATE_CALCULATED",
      entityType: "LogisticsRequest",
      entityId: request.id,
      metadata: { distanceKm: route.distanceKm, cost: cost.totalCost },
      ...meta,
    });
    trackEvent("logistics_estimate_calculated", user.id, { distanceKm: route.distanceKm });

    return {
      estimatedDistanceKm: round2(route.distanceKm),
      estimatedDurationMinutes: Math.round(route.durationMinutes),
      estimatedCost: cost.totalCost,
      currency: cost.currency,
      isEstimated: true,
      suitableVehicleCount,
    };
  }

  /** Step 6/7 — every eligible AND ineligible candidate, with explicit
   * reasons (Step 5: "Do not silently exclude vehicles"). */
  async listAvailableProviders(user: AuthenticatedUserContext, publicId: string): Promise<AvailableProviderEntry[]> {
    const request = await this.loadRequestOrThrow(publicId);
    await this.assertCanManage(user, request);

    const requiredQuantityKg = decimalToNumber(request.requiredQuantityKg);
    const candidates = await this.vehicleDiscovery.findCandidates({ minimumCapacityKg: requiredQuantityKg });

    const entries: AvailableProviderEntry[] = [];
    for (const candidate of candidates) {
      const hasConflict = await this.quotes.hasConflictingAcceptedQuote(
        candidate.vehicleId,
        request.requestedPickupAt,
        request.deliveryDeadline,
      );
      const result = this.vehicleEligibility.evaluate(
        {
          id: candidate.vehicleId,
          status: candidate.status as never,
          verificationStatus: candidate.verificationStatus as never,
          availabilityStatus: candidate.availabilityStatus as never,
          capacityKg: candidate.capacityKg,
          capabilities: candidate.capabilities,
          isRefrigerated: candidate.isRefrigerated,
        },
        {
          id: candidate.transporterId,
          isActive: candidate.transporterIsActive,
          verificationStatus: candidate.transporterVerificationStatus as never,
        },
        {
          requiredCapacityKg: requiredQuantityKg,
          requiresRefrigeration: request.requiresRefrigeration,
          requiredCapabilities: request.requiredCapabilities,
          hasConflictingCommitment: hasConflict,
        },
      );
      entries.push({
        transportProviderId: candidate.transporterPublicId,
        transporterBusinessName: candidate.transporterBusinessName,
        vehicleId: candidate.vehiclePublicId,
        vehicleType: candidate.vehicleType,
        capacityKg: candidate.capacityKg,
        eligible: result.eligible,
        reasons: result.reasons,
      });
    }
    return entries;
  }

  /** Step 9/13 — deterministic ranking over every currently-considerable
   * (SUBMITTED, not expired) quote on this request. */
  async optimize(user: AuthenticatedUserContext, publicId: string, meta?: RequestMeta): Promise<OptimizeRequestResult> {
    const request = await this.loadRequestOrThrow(publicId);
    await this.assertCanManage(user, request);

    if (request.status !== "OPEN") {
      throw new LogisticsDomainError("Only an open logistics request can be optimized.", "LOGISTICS_REQUEST_NOT_OPEN");
    }

    const allQuotes = await this.quotes.listByRequestId(request.id);
    const now = new Date();
    const considerable = allQuotes.filter((q) => q.status === "SUBMITTED" && (!q.validUntil || q.validUntil.getTime() >= now.getTime()));

    if (considerable.length === 0) {
      throw new LogisticsDomainError(
        "There are no active quotes to optimize yet. Wait for at least one provider to submit a quote.",
        "NO_QUOTES_TO_OPTIMIZE",
      );
    }

    const candidates: OptimizationCandidate[] = [];
    for (const quote of considerable) {
      const vehicle = await this.vehicles.findById(quote.vehicleId);
      const reliability = await this.reliability.getReliability(quote.transportProviderId);
      candidates.push({
        quoteId: quote.id,
        quotedAmount: decimalToNumber(quote.quotedAmount),
        estimatedDistanceKm: nullableDecimalToNumber(quote.estimatedDistanceKm) ?? decimalToNumber(request.estimatedDistanceKm ?? 0),
        estimatedDurationMinutes: quote.estimatedDurationMinutes ?? request.estimatedDurationMinutes ?? 0,
        vehicleCapacityKg: vehicle ? decimalToNumber(vehicle.capacityKg) : decimalToNumber(request.requiredQuantityKg),
        reliabilityScore: reliability.score,
        reliabilitySource: reliability.source,
      });
    }

    const weights = getOptimizationWeights();
    const result = this.optimizationEngine.rank(candidates, { requiredCapacityKg: decimalToNumber(request.requiredQuantityKg) }, weights);

    await this.optimizationResults.create(request.id, result);
    await this.requests.setRecommendedQuote(request.id, result.recommendedQuoteId);

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_OPTIMIZATION_CALCULATED",
      entityType: "LogisticsRequest",
      entityId: request.id,
      metadata: { algorithmVersion: result.algorithmVersion, candidateCount: candidates.length },
      ...meta,
    });
    trackEvent("logistics_optimization_completed", user.id, { candidateCount: candidates.length });

    const quoteById = new Map(considerable.map((q) => [q.id, q]));
    const recommendedEntry = result.rankings[0] ?? null;
    let recommended: OptimizeRequestResult["recommended"] = null;
    if (recommendedEntry) {
      const quote = quoteById.get(recommendedEntry.quoteId)!;
      recommended = {
        quoteId: quote.publicId,
        score: recommendedEntry.score,
        transportProviderId: quote.transportProviderId,
        vehicleId: quote.vehicleId,
        quotedAmount: decimalToNumber(quote.quotedAmount),
        currency: quote.currency,
        estimatedDistanceKm: nullableDecimalToNumber(quote.estimatedDistanceKm),
        estimatedDurationMinutes: quote.estimatedDurationMinutes,
        reasons: recommendedEntry.reasons,
      };
    }

    const alternatives = result.rankings.slice(1).map((entry) => ({
      rank: entry.rank,
      quoteId: quoteById.get(entry.quoteId)!.publicId,
      score: entry.score,
      reasons: entry.reasons,
    }));

    return {
      algorithmVersion: result.algorithmVersion,
      calculatedAt: now.toISOString(),
      recommended,
      alternatives,
    };
  }

  /** recommendedQuoteId/acceptedQuoteId are stored as internal ids —
   * resolved to publicIds here since the API must never leak an internal
   * id (Step 6). Both are null on the vast majority of rows (only set
   * after optimize()/accept()), so this is at most two extra point-reads,
   * skipped entirely when both are null. */
  private async toDTO(row: LogisticsRequestRecord): Promise<LogisticsRequestPublicDTO> {
    const idsToResolve = [row.recommendedQuoteId, row.acceptedQuoteId].filter((id): id is string => id !== null);
    const map = new Map<string, string>();
    for (const id of idsToResolve) {
      const quote = await this.quotes.findById(id);
      if (quote) map.set(id, quote.publicId);
    }
    return toLogisticsRequestPublicDTO(row, map);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
