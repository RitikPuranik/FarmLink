import { LogisticsQuoteStatus, LogisticsRequestStatus, PrismaClient } from "@prisma/client";
import { LogisticsQuoteRecord } from "./logistics.types";

export interface CreateLogisticsQuoteData {
  logisticsRequestId: string;
  transportProviderId: string;
  vehicleId: string;
  quotedAmount: number;
  currency: string;
  estimatedPickupTime?: Date | null;
  estimatedDeliveryTime?: Date | null;
  estimatedDistanceKm?: number | null;
  estimatedDurationMinutes?: number | null;
  notes?: string | null;
  validUntil: Date;
}

export interface UpdateLogisticsQuoteData {
  quotedAmount?: number;
  estimatedPickupTime?: Date | null;
  estimatedDeliveryTime?: Date | null;
  estimatedDistanceKm?: number | null;
  estimatedDurationMinutes?: number | null;
  notes?: string | null;
  validUntil?: Date;
}

export interface LogisticsQuoteListFilters {
  logisticsRequestId?: string;
  transportProviderId?: string;
  status?: LogisticsQuoteStatus;
  page: number;
  limit: number;
}

export interface LogisticsQuotePage {
  items: LogisticsQuoteRecord[];
  total: number;
}

/** Step 11 — result of an atomic accept-quote transaction. `accepted` is
 * null when the accept lost a race (the request was no longer OPEN, or
 * the quote was no longer SUBMITTED, by the time the conditional update
 * ran) — the caller (LogisticsQuoteService) turns that into the
 * appropriate domain error rather than this layer throwing. */
export interface AcceptQuoteResult {
  accepted: LogisticsQuoteRecord | null;
  rejectedQuoteIds: string[];
}

export interface LogisticsQuoteRepository {
  create(data: CreateLogisticsQuoteData): Promise<LogisticsQuoteRecord>;
  findById(id: string): Promise<LogisticsQuoteRecord | null>;
  findByPublicId(publicId: string): Promise<LogisticsQuoteRecord | null>;
  list(filters: LogisticsQuoteListFilters): Promise<LogisticsQuotePage>;
  listByRequestId(logisticsRequestId: string): Promise<LogisticsQuoteRecord[]>;
  update(id: string, data: UpdateLogisticsQuoteData): Promise<LogisticsQuoteRecord>;
  /** Atomic conditional transition — same "conditional updateMany, null on
   * 0 rows" pattern as CropLotRepository.transition() /
   * LogisticsRequestRepository.transition(). */
  transition(
    id: string,
    fromStatuses: LogisticsQuoteStatus[],
    toStatus: LogisticsQuoteStatus,
    timestampField: "acceptedAt" | "rejectedAt" | "withdrawnAt" | "expiredAt",
  ): Promise<LogisticsQuoteRecord | null>;
  /** Step 5/15 — has this vehicle already got an ACCEPTED quote whose
   * pickup/delivery window could overlap the given window? Used by
   * VehicleEligibilityService's caller, never by the pure eligibility
   * function itself. */
  hasConflictingAcceptedQuote(vehicleId: string, windowStart: Date | null, windowEnd: Date | null): Promise<boolean>;
  /** Step 11 — the whole atomic acceptance transaction: verify + accept +
   * reject competitors + close the request, all inside one DB
   * transaction so two concurrent accept attempts can never both
   * succeed (Step 8/11/15). */
  acceptQuoteTransaction(logisticsRequestId: string, quoteId: string, now: Date): Promise<AcceptQuoteResult>;
}

export class PrismaLogisticsQuoteRepository implements LogisticsQuoteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreateLogisticsQuoteData) {
    return this.prisma.logisticsQuote.create({
      data: {
        logisticsRequestId: data.logisticsRequestId,
        transportProviderId: data.transportProviderId,
        vehicleId: data.vehicleId,
        quotedAmount: data.quotedAmount,
        currency: data.currency,
        estimatedPickupTime: data.estimatedPickupTime ?? null,
        estimatedDeliveryTime: data.estimatedDeliveryTime ?? null,
        estimatedDistanceKm: data.estimatedDistanceKm ?? null,
        estimatedDurationMinutes: data.estimatedDurationMinutes ?? null,
        notes: data.notes ?? null,
        validUntil: data.validUntil,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });
  }

  findById(id: string) {
    return this.prisma.logisticsQuote.findUnique({ where: { id } });
  }

  findByPublicId(publicId: string) {
    return this.prisma.logisticsQuote.findUnique({ where: { publicId } });
  }

  async list(filters: LogisticsQuoteListFilters): Promise<LogisticsQuotePage> {
    const where = {
      ...(filters.logisticsRequestId ? { logisticsRequestId: filters.logisticsRequestId } : {}),
      ...(filters.transportProviderId ? { transportProviderId: filters.transportProviderId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.logisticsQuote.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.logisticsQuote.count({ where }),
    ]);
    return { items, total };
  }

  listByRequestId(logisticsRequestId: string) {
    return this.prisma.logisticsQuote.findMany({
      where: { logisticsRequestId },
      orderBy: { createdAt: "asc" },
    });
  }

  update(id: string, data: UpdateLogisticsQuoteData) {
    return this.prisma.logisticsQuote.update({
      where: { id },
      data: {
        ...(data.quotedAmount !== undefined ? { quotedAmount: data.quotedAmount } : {}),
        ...(data.estimatedPickupTime !== undefined ? { estimatedPickupTime: data.estimatedPickupTime } : {}),
        ...(data.estimatedDeliveryTime !== undefined ? { estimatedDeliveryTime: data.estimatedDeliveryTime } : {}),
        ...(data.estimatedDistanceKm !== undefined ? { estimatedDistanceKm: data.estimatedDistanceKm } : {}),
        ...(data.estimatedDurationMinutes !== undefined
          ? { estimatedDurationMinutes: data.estimatedDurationMinutes }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.validUntil !== undefined ? { validUntil: data.validUntil } : {}),
      },
    });
  }

  async transition(
    id: string,
    fromStatuses: LogisticsQuoteStatus[],
    toStatus: LogisticsQuoteStatus,
    timestampField: "acceptedAt" | "rejectedAt" | "withdrawnAt" | "expiredAt",
  ): Promise<LogisticsQuoteRecord | null> {
    const result = await this.prisma.logisticsQuote.updateMany({
      where: { id, status: { in: fromStatuses } },
      data: { status: toStatus, [timestampField]: new Date() },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async hasConflictingAcceptedQuote(
    vehicleId: string,
    windowStart: Date | null,
    windowEnd: Date | null,
  ): Promise<boolean> {
    // Conservative overlap check: any other ACCEPTED quote for this
    // vehicle whose own [pickup, delivery] window intersects the given
    // window. If either window's bounds are unknown, treated as
    // "possibly conflicting" (never silently assumed clear — Step 5:
    // "Do not silently exclude vehicles" cuts both ways, a false
    // negative here would double-book a vehicle).
    const existing = await this.prisma.logisticsQuote.findMany({
      where: { vehicleId, status: "ACCEPTED" },
      select: { estimatedPickupTime: true, estimatedDeliveryTime: true },
    });
    if (existing.length === 0) return false;
    if (!windowStart || !windowEnd) return existing.length > 0;

    return existing.some((row: { estimatedPickupTime: Date | null; estimatedDeliveryTime: Date | null }) => {
      if (!row.estimatedPickupTime || !row.estimatedDeliveryTime) return true;
      return row.estimatedPickupTime.getTime() <= windowEnd.getTime() && row.estimatedDeliveryTime.getTime() >= windowStart.getTime();
    });
  }

  async acceptQuoteTransaction(logisticsRequestId: string, quoteId: string, now: Date): Promise<AcceptQuoteResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma's
    // own `Prisma.TransactionClient` type (the real type of this callback's
    // parameter) isn't a strict sub/supertype of `PrismaClient`, so `any` is
    // the correct, deliberate annotation here rather than a workaround.
    return this.prisma.$transaction(async (tx: any) => {
      // 1. Atomically flip the request OPEN -> QUOTE_ACCEPTED, recording
      //    which quote won. If this updates 0 rows, either the request
      //    was already decided/cancelled or never existed — either way,
      //    nothing else in this transaction should run.
      const requestUpdate = await tx.logisticsRequest.updateMany({
        where: { id: logisticsRequestId, status: "OPEN" as LogisticsRequestStatus },
        data: { status: "QUOTE_ACCEPTED", acceptedQuoteId: quoteId },
      });
      if (requestUpdate.count === 0) {
        return { accepted: null, rejectedQuoteIds: [] };
      }

      // 2. Atomically flip the chosen quote SUBMITTED -> ACCEPTED. If this
      //    loses (0 rows), someone else already decided this exact quote
      //    (withdrawn/expired/already accepted elsewhere) between the
      //    caller's own read and now — roll back the request flip too by
      //    throwing, so the whole transaction aborts atomically rather
      //    than leaving requestUpdate committed with no accepted quote.
      const quoteUpdate = await tx.logisticsQuote.updateMany({
        where: { id: quoteId, logisticsRequestId, status: "SUBMITTED" as LogisticsQuoteStatus },
        data: { status: "ACCEPTED", acceptedAt: now },
      });
      if (quoteUpdate.count === 0) {
        throw new QuoteRaceLostError();
      }

      // 3. Close out every other still-open quote on this request — they
      //    were never going to be chosen once one is accepted (Step 8:
      //    "reject/close competing quotes where appropriate").
      const competitors = await tx.logisticsQuote.findMany({
        where: { logisticsRequestId, status: "SUBMITTED", id: { not: quoteId } },
        select: { id: true },
      });
      if (competitors.length > 0) {
        await tx.logisticsQuote.updateMany({
          where: { id: { in: competitors.map((c: { id: string }) => c.id) } },
          data: { status: "REJECTED", rejectedAt: now },
        });
      }

      const accepted = await tx.logisticsQuote.findUnique({ where: { id: quoteId } });
      return { accepted, rejectedQuoteIds: competitors.map((c: { id: string }) => c.id) };
    }).catch((err: unknown) => {
      if (err instanceof QuoteRaceLostError) {
        return { accepted: null, rejectedQuoteIds: [] };
      }
      throw err;
    });
  }
}

/** Internal-only sentinel used to abort acceptQuoteTransaction's $transaction
 * callback (Prisma rolls back the whole transaction on any thrown error)
 * when the quote itself lost the race after the request-level check
 * already passed — never leaked outside this file. */
class QuoteRaceLostError extends Error {}
