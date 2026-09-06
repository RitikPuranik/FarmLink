import {
  NetRealizationCalculation,
  NetRealizationPriceSourceType,
  NetRealizationStatus,
  PrismaClient,
  Prisma,
  RealizationCompleteness,
} from "@prisma/client";
import { NetRealizationInput } from "./net-realization.types";

// Part S — a lot can accumulate one calculation per POST call with no
// pagination contract of its own yet (mirrors SellStoreDecisionRepository's
// own MAX_HISTORY_RESULTS reasoning exactly). Generous enough that no
// realistic lot's history is truncated today, while still bounding an
// unpaginated query against a very long-lived/frequently-calculated lot.
const MAX_HISTORY_RESULTS = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface CompleteCalculationData {
  currency: string;
  priceSourceOfferId: string | null;
  priceSourceType: NetRealizationPriceSourceType;
  salePricePerUnit: number | null;
  saleQuantityKg: number | null;
  grossRevenue: number | null;
  totalKnownCosts: number | null;
  totalEstimatedCosts: number | null;
  totalUserProvidedCosts: number | null;
  totalDeductions: number | null;
  netRealization: number | null;
  completeness: RealizationCompleteness;
  dataCompletenessScore: number | null;
  inputSnapshot: NetRealizationInput;
  calculationMetadata: Prisma.InputJsonValue;
}

export interface PaginatedCalculations {
  items: NetRealizationCalculation[];
  total: number;
  page: number;
  pageSize: number;
}

export class NetRealizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPendingCalculation(
    lotId: string,
    cropId: string,
    requestedByUserId: string | null,
  ): Promise<NetRealizationCalculation> {
    return this.prisma.netRealizationCalculation.create({
      data: {
        lotId,
        cropId,
        requestedByUserId,
        status: "PENDING",
      },
    });
  }

  async completeCalculation(id: string, data: CompleteCalculationData): Promise<NetRealizationCalculation> {
    return this.prisma.netRealizationCalculation.update({
      where: { id },
      data: {
        status: "COMPLETED",
        currency: data.currency,
        priceSourceOfferId: data.priceSourceOfferId,
        priceSourceType: data.priceSourceType,
        salePricePerUnit: data.salePricePerUnit,
        saleQuantityKg: data.saleQuantityKg,
        grossRevenue: data.grossRevenue,
        totalKnownCosts: data.totalKnownCosts,
        totalEstimatedCosts: data.totalEstimatedCosts,
        totalUserProvidedCosts: data.totalUserProvidedCosts,
        totalDeductions: data.totalDeductions,
        netRealization: data.netRealization,
        completeness: data.completeness,
        dataCompletenessScore: data.dataCompletenessScore,
        inputSnapshot: data.inputSnapshot as unknown as Prisma.InputJsonValue,
        calculationMetadata: data.calculationMetadata,
      },
    });
  }

  /** Part I: INSUFFICIENT_DATA is a valid, non-exceptional outcome — this
   * still persists the (empty-ish) snapshot/metadata so a caller can see
   * exactly why, without pretending a calculation ran to completion. */
  async markInsufficient(
    id: string,
    priceSourceType: NetRealizationPriceSourceType,
    inputSnapshot: NetRealizationInput,
    calculationMetadata: Prisma.InputJsonValue,
  ): Promise<NetRealizationCalculation> {
    return this.prisma.netRealizationCalculation.update({
      where: { id },
      data: {
        status: "INSUFFICIENT_DATA",
        priceSourceType,
        inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
        calculationMetadata,
      },
    });
  }

  async failCalculation(id: string): Promise<NetRealizationCalculation> {
    return this.prisma.netRealizationCalculation.update({
      where: { id },
      data: { status: "FAILED" },
    });
  }

  async findByPublicId(publicId: string): Promise<NetRealizationCalculation | null> {
    return this.prisma.netRealizationCalculation.findUnique({ where: { publicId } });
  }

  async findById(id: string): Promise<NetRealizationCalculation | null> {
    return this.prisma.netRealizationCalculation.findUnique({ where: { id } });
  }

  /** Unpaginated, bounded convenience list (mirrors
   * SellStoreDecisionRepository.listByLotId) — kept for callers that just
   * want "the recent history", separate from listByLotIdPaginated's
   * page/pageSize contract below. */
  async listByLotId(lotId: string): Promise<NetRealizationCalculation[]> {
    return this.prisma.netRealizationCalculation.findMany({
      where: { lotId, status: { in: ["COMPLETED", "INSUFFICIENT_DATA"] } },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_RESULTS,
    });
  }

  /** Part K/S — the paginated historical list endpoint. Never loads
   * unbounded history: page/pageSize are always clamped server-side. */
  async listByLotIdPaginated(lotId: string, page: number, pageSize: number): Promise<PaginatedCalculations> {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize || DEFAULT_PAGE_SIZE)));

    const where = { lotId, status: { in: ["COMPLETED", "INSUFFICIENT_DATA"] as NetRealizationStatus[] } };
    const [items, total] = await Promise.all([
      this.prisma.netRealizationCalculation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.netRealizationCalculation.count({ where }),
    ]);

    return { items, total, page: safePage, pageSize: safePageSize };
  }
}
