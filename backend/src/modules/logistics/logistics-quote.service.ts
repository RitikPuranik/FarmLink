import { LogisticsQuoteStatus } from "@prisma/client";
import { AuthorizationError, LogisticsDomainError, NotFoundError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { CropLotRepository } from "../lots/lots.repository";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { TransporterAuthorizationService } from "../transporters/transporter.authorization";
import { TransporterRepository } from "../transporters/transporter.repository";
import { VehicleRepository } from "../transporters/vehicle.repository";
import { LogisticsAuthorizationService } from "./logistics.authorization";
import { LogisticsRequestRepository } from "./logistics-request.repository";
import { CreateLogisticsQuoteData, LogisticsQuoteRepository, UpdateLogisticsQuoteData } from "./logistics-quote.repository";
import { VehicleEligibilityService } from "./vehicle-eligibility.service";
import { isQuoteConsiderable } from "./logistics-quote-state-machine";
import { getDefaultQuoteValidityHours } from "./logistics.config";
import {
  LogisticsQuotePublicDTO,
  LogisticsQuoteRecord,
  LogisticsRequestRecord,
  decimalToNumber,
  toLogisticsQuotePublicDTO,
} from "./logistics.types";

export interface SubmitQuoteInput {
  vehicleId: string;
  quotedAmount: number;
  currency: string;
  estimatedPickupTime?: Date;
  estimatedDeliveryTime?: Date;
  notes?: string;
  validUntil?: Date;
}

export interface UpdateQuoteInput {
  quotedAmount?: number;
  estimatedPickupTime?: Date;
  estimatedDeliveryTime?: Date;
  notes?: string;
  validUntil?: Date;
}

export interface ListQuotesInput {
  status?: LogisticsQuoteStatus;
  page: number;
  limit: number;
}

/**
 * Step 7/8/11/15 — LogisticsQuote lifecycle. Every write re-validates
 * ownership/eligibility server-side (Step 15: "Never trust providerId,
 * vehicleId, ownerId, requesterId from the frontend") — the only things
 * ever trusted from the client are the request/quote *publicId*s used to
 * look rows up, never who owns them.
 */
export class LogisticsQuoteService {
  constructor(
    private readonly quotes: LogisticsQuoteRepository,
    private readonly requests: LogisticsRequestRepository,
    private readonly cropLots: CropLotRepository,
    private readonly farmerProfiles: FarmerProfileResolver,
    private readonly authorization: LogisticsAuthorizationService,
    private readonly transporterAuthorization: TransporterAuthorizationService,
    private readonly transporters: TransporterRepository,
    private readonly vehicles: VehicleRepository,
    private readonly vehicleEligibility: VehicleEligibilityService,
    private readonly audit: AuditService,
  ) {}

  private async loadRequestOrThrow(id: string): Promise<LogisticsRequestRecord> {
    const request = await this.requests.findById(id);
    if (!request) throw new NotFoundError("Logistics request not found.");
    return request;
  }

  private async loadQuoteOrThrow(publicId: string): Promise<LogisticsQuoteRecord> {
    const quote = await this.quotes.findByPublicId(publicId);
    if (!quote) throw new NotFoundError("Logistics quote not found.");
    return quote;
  }

  private async assertCanManageRequest(user: AuthenticatedUserContext, request: LogisticsRequestRecord): Promise<void> {
    const lot = await this.cropLots.findById(request.lotId);
    if (!lot) throw new NotFoundError("Lot not found.");
    const callerFarmerProfileId = user.role === "FARMER" ? (await this.farmerProfiles.ensure(user.id)).id : null;
    const canManage = await this.authorization.canManageRequest(
      user,
      request,
      { ownerType: lot.ownerType, farmerId: lot.farmerId, fpoId: lot.fpoId },
      callerFarmerProfileId,
    );
    this.authorization.assertCanDecide(user, request, canManage);
  }

  /** Step 7 — TRANSPORTER submits a quote against an OPEN request, for one
   * of their own vehicles. DRAFT is never created through this endpoint —
   * see logistics-quote-state-machine.ts's own comment on why DRAFT
   * exists in the enum without being reachable today. */
  async submitQuote(
    user: AuthenticatedUserContext,
    requestPublicId: string,
    input: SubmitQuoteInput,
    meta?: RequestMeta,
  ): Promise<LogisticsQuotePublicDTO> {
    const request = await this.requests.findByPublicId(requestPublicId);
    if (!request) throw new NotFoundError("Logistics request not found.");

    if (request.status !== "OPEN") {
      throw new LogisticsDomainError("This logistics request is no longer accepting quotes.", "LOGISTICS_REQUEST_NOT_OPEN");
    }

    const provider = await this.transporterAuthorization.resolveOwnProfile(user);

    const vehicle = await this.vehicles.findByPublicId(input.vehicleId);
    if (!vehicle) throw new NotFoundError("Vehicle not found.");
    // Step 7/15 — never trust that the vehicle belongs to this provider;
    // re-verify server-side every time.
    if (vehicle.transporterId !== provider.id) {
      throw new LogisticsDomainError(
        "You can only submit a quote using one of your own vehicles.",
        "VEHICLE_OWNERSHIP_MISMATCH",
        403,
      );
    }

    const requiredQuantityKg = decimalToNumber(request.requiredQuantityKg);
    const hasConflict = await this.quotes.hasConflictingAcceptedQuote(vehicle.id, request.requestedPickupAt, request.deliveryDeadline);
    const eligibility = this.vehicleEligibility.evaluate(
      {
        id: vehicle.id,
        status: vehicle.status as never,
        verificationStatus: vehicle.verificationStatus as never,
        availabilityStatus: vehicle.availabilityStatus as never,
        capacityKg: decimalToNumber(vehicle.capacityKg),
        capabilities: vehicle.capabilities,
        isRefrigerated: vehicle.isRefrigerated,
      },
      { id: provider.id, isActive: provider.isActive, verificationStatus: provider.verificationStatus as never },
      {
        requiredCapacityKg: requiredQuantityKg,
        requiresRefrigeration: request.requiresRefrigeration,
        requiredCapabilities: request.requiredCapabilities,
        hasConflictingCommitment: hasConflict,
      },
    );
    if (!eligibility.eligible) {
      throw new LogisticsDomainError(
        `This vehicle is not eligible for this logistics request: ${eligibility.reasons.join(", ")}.`,
        "VEHICLE_NOT_ELIGIBLE",
      );
    }

    const validUntil = input.validUntil ?? new Date(Date.now() + getDefaultQuoteValidityHours() * 60 * 60 * 1000);

    const data: CreateLogisticsQuoteData = {
      logisticsRequestId: request.id,
      transportProviderId: provider.id,
      vehicleId: vehicle.id,
      quotedAmount: input.quotedAmount,
      currency: input.currency,
      estimatedPickupTime: input.estimatedPickupTime ?? null,
      estimatedDeliveryTime: input.estimatedDeliveryTime ?? null,
      notes: input.notes ?? null,
      validUntil,
    };

    const created = await this.quotes.create(data);

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_QUOTE_SUBMITTED",
      entityType: "LogisticsQuote",
      entityId: created.id,
      metadata: { logisticsRequestId: request.publicId, quotedAmount: input.quotedAmount },
      ...meta,
    });
    trackEvent("logistics_quote_submitted", user.id, { quotedAmount: input.quotedAmount });

    return this.toDTO(created, request.publicId, provider.publicId, vehicle.publicId);
  }

  async getQuote(user: AuthenticatedUserContext, quotePublicId: string): Promise<LogisticsQuotePublicDTO> {
    const quote = await this.loadQuoteOrThrow(quotePublicId);
    const request = await this.loadRequestOrThrow(quote.logisticsRequestId);
    await this.assertCanViewQuote(user, quote, request);
    return this.buildDTO(quote, request);
  }

  private async assertCanViewQuote(
    user: AuthenticatedUserContext,
    quote: LogisticsQuoteRecord,
    request: LogisticsRequestRecord,
  ): Promise<void> {
    if (user.role === "ADMIN") return;
    if (user.role === "TRANSPORTER") {
      const provider = await this.transporterAuthorization.resolveOwnProfile(user);
      if (provider.id === quote.transportProviderId) return;
      throw new AuthorizationError("You do not have permission to view this quote.");
    }
    await this.assertCanManageRequest(user, request);
  }

  async listQuotesForRequest(
    user: AuthenticatedUserContext,
    requestPublicId: string,
    filters: ListQuotesInput,
  ): Promise<{ items: LogisticsQuotePublicDTO[]; total: number; page: number; limit: number }> {
    const request = await this.requests.findByPublicId(requestPublicId);
    if (!request) throw new NotFoundError("Logistics request not found.");

    let transportProviderId: string | undefined;
    if (user.role === "TRANSPORTER") {
      // Step 15 — a provider only ever sees their own quote's amount on a
      // request, never a competitor's (competitive bidding privacy) —
      // filtered at the query level, not just hidden in the response.
      const provider = await this.transporterAuthorization.resolveOwnProfile(user);
      transportProviderId = provider.id;
    } else {
      await this.assertCanManageRequest(user, request);
    }

    const page = await this.quotes.list({
      logisticsRequestId: request.id,
      transportProviderId,
      status: filters.status,
      page: filters.page,
      limit: filters.limit,
    });

    return {
      items: await Promise.all(page.items.map((row) => this.buildDTO(row, request))),
      total: page.total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  async listMyQuotes(
    user: AuthenticatedUserContext,
    filters: ListQuotesInput,
  ): Promise<{ items: LogisticsQuotePublicDTO[]; total: number; page: number; limit: number }> {
    const provider = await this.transporterAuthorization.resolveOwnProfile(user);
    const page = await this.quotes.list({
      transportProviderId: provider.id,
      status: filters.status,
      page: filters.page,
      limit: filters.limit,
    });
    const items: LogisticsQuotePublicDTO[] = [];
    for (const row of page.items) {
      const request = await this.loadRequestOrThrow(row.logisticsRequestId);
      items.push(await this.buildDTO(row, request));
    }
    return { items, total: page.total, page: filters.page, limit: filters.limit };
  }

  private async resolveCallerProviderId(user: AuthenticatedUserContext): Promise<string | null> {
    if (user.role !== "TRANSPORTER") return null;
    return (await this.transporterAuthorization.resolveOwnProfile(user)).id;
  }

  async updateQuote(
    user: AuthenticatedUserContext,
    quotePublicId: string,
    input: UpdateQuoteInput,
    meta?: RequestMeta,
  ): Promise<LogisticsQuotePublicDTO> {
    const quote = await this.loadQuoteOrThrow(quotePublicId);
    const callerProviderId = await this.resolveCallerProviderId(user);
    this.authorization.assertOwnsQuoteProvider(user, quote.transportProviderId, callerProviderId);

    if (quote.status !== "SUBMITTED") {
      throw new LogisticsDomainError("Only a submitted quote can be updated.", "INVALID_QUOTE_TRANSITION");
    }

    const data: UpdateLogisticsQuoteData = {
      quotedAmount: input.quotedAmount,
      estimatedPickupTime: input.estimatedPickupTime,
      estimatedDeliveryTime: input.estimatedDeliveryTime,
      notes: input.notes,
      validUntil: input.validUntil,
    };
    const updated = await this.quotes.update(quote.id, data);
    const request = await this.loadRequestOrThrow(quote.logisticsRequestId);

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_QUOTE_UPDATED",
      entityType: "LogisticsQuote",
      entityId: quote.id,
      ...meta,
    });

    return this.buildDTO(updated, request);
  }

  async withdrawQuote(user: AuthenticatedUserContext, quotePublicId: string, meta?: RequestMeta): Promise<LogisticsQuotePublicDTO> {
    const quote = await this.loadQuoteOrThrow(quotePublicId);
    const callerProviderId = await this.resolveCallerProviderId(user);
    this.authorization.assertOwnsQuoteProvider(user, quote.transportProviderId, callerProviderId);

    const updated = await this.quotes.transition(quote.id, ["SUBMITTED"], "WITHDRAWN", "withdrawnAt");
    if (!updated) {
      throw new LogisticsDomainError("Only a submitted quote can be withdrawn.", "INVALID_QUOTE_TRANSITION");
    }

    const request = await this.loadRequestOrThrow(quote.logisticsRequestId);

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_QUOTE_WITHDRAWN",
      entityType: "LogisticsQuote",
      entityId: quote.id,
      ...meta,
    });

    return this.buildDTO(updated, request);
  }

  /** Step 11 — the whole accept flow runs inside one atomic DB transaction
   * (logistics-quote.repository.ts's own acceptQuoteTransaction) so two
   * concurrent accept attempts against the same request can never both
   * succeed. */
  async acceptQuote(user: AuthenticatedUserContext, quotePublicId: string, meta?: RequestMeta): Promise<LogisticsQuotePublicDTO> {
    const quote = await this.loadQuoteOrThrow(quotePublicId);
    const request = await this.loadRequestOrThrow(quote.logisticsRequestId);
    await this.assertCanManageRequest(user, request);

    if (!isQuoteConsiderable(quote.status, quote.validUntil)) {
      if (quote.validUntil && quote.validUntil.getTime() < Date.now() && quote.status === "SUBMITTED") {
        throw new LogisticsDomainError("This quote has expired and can no longer be accepted.", "QUOTE_EXPIRED");
      }
      throw new LogisticsDomainError("This quote is no longer available to accept.", "QUOTE_ALREADY_DECIDED");
    }

    const result = await this.quotes.acceptQuoteTransaction(request.id, quote.id, new Date());
    if (!result.accepted) {
      // Re-read to give the caller a precise, current-state error rather
      // than a generic "failed" (Step 11: a lost race must be explainable
      // too, not just silently rejected).
      const currentRequest = await this.requests.findById(request.id);
      if (currentRequest && currentRequest.status !== "OPEN") {
        throw new LogisticsDomainError(
          "This logistics request already has an accepted quote or has been cancelled.",
          "LOGISTICS_REQUEST_NOT_OPEN",
        );
      }
      throw new LogisticsDomainError("This quote was just withdrawn, expired, or already decided by someone else.", "QUOTE_ALREADY_DECIDED");
    }

    // Step 11 — "reserve/lock the vehicle availability for the relevant
    // window if Module 15 supports this": it does — VehicleAvailabilityStatus.RESERVED
    // exists specifically for this (see vehicle.routes.ts's own comment:
    // "RESERVED/IN_TRANSIT are reserved for Module 16/17's own internal
    // transitions"). Best-effort: if this fails, the accepted quote itself
    // is already committed and correct — a vehicle left AVAILABLE after
    // acceptance is a lesser problem than losing the acceptance transaction
    // that already succeeded, so this is never allowed to roll that back.
    try {
      await this.vehicles.updateAvailability(result.accepted.vehicleId, "RESERVED");
    } catch (err) {
      // Swallow — see comment above. The accepted quote's own status is
      // the source of truth; a real routing/dispatch module (17+) should
      // reconcile availability from accepted quotes rather than solely
      // trust this best-effort flip.
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_QUOTE_ACCEPTED",
      entityType: "LogisticsQuote",
      entityId: quote.id,
      metadata: { logisticsRequestId: request.publicId, rejectedCompetitorCount: result.rejectedQuoteIds.length },
      ...meta,
    });
    if (result.rejectedQuoteIds.length > 0) {
      await this.audit.record({
        actorUserId: user.id,
        action: "LOGISTICS_QUOTE_REJECTED",
        entityType: "LogisticsRequest",
        entityId: request.id,
        metadata: { reason: "SUPERSEDED_BY_ACCEPTED_QUOTE", quoteIds: result.rejectedQuoteIds },
        ...meta,
      });
    }
    trackEvent("logistics_quote_accepted", user.id, { logisticsRequestId: request.publicId });

    return this.buildDTO(result.accepted, { ...request, status: "QUOTE_ACCEPTED", acceptedQuoteId: quote.id });
  }

  async rejectQuote(user: AuthenticatedUserContext, quotePublicId: string, meta?: RequestMeta): Promise<LogisticsQuotePublicDTO> {
    const quote = await this.loadQuoteOrThrow(quotePublicId);
    const request = await this.loadRequestOrThrow(quote.logisticsRequestId);
    await this.assertCanManageRequest(user, request);

    const updated = await this.quotes.transition(quote.id, ["SUBMITTED"], "REJECTED", "rejectedAt");
    if (!updated) {
      throw new LogisticsDomainError("Only a submitted quote can be rejected.", "INVALID_QUOTE_TRANSITION");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "LOGISTICS_QUOTE_REJECTED",
      entityType: "LogisticsQuote",
      entityId: quote.id,
      ...meta,
    });
    trackEvent("logistics_quote_rejected", user.id, { logisticsRequestId: request.publicId });

    return this.buildDTO(updated, request);
  }

  private async buildDTO(quote: LogisticsQuoteRecord, request: LogisticsRequestRecord): Promise<LogisticsQuotePublicDTO> {
    const vehicle = await this.vehicles.findById(quote.vehicleId);
    const provider = await this.transporters.findById(quote.transportProviderId);
    return this.toDTO(quote, request.publicId, provider?.publicId ?? quote.transportProviderId, vehicle?.publicId ?? quote.vehicleId);
  }

  private toDTO(
    row: LogisticsQuoteRecord,
    requestPublicId: string,
    transportProviderPublicId: string,
    vehiclePublicId: string,
  ): LogisticsQuotePublicDTO {
    return toLogisticsQuotePublicDTO(row, requestPublicId, transportProviderPublicId, vehiclePublicId);
  }
}
