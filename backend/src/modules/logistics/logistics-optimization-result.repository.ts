import { PrismaClient } from "@prisma/client";
import { OptimizationResult } from "./logistics-optimization.engine";

/**
 * Step 2/9 — persists one immutable LogisticsOptimizationResult row per
 * optimize() run. Deliberately its own tiny repository (not folded into
 * LogisticsRequestRepository) since it is create-and-list-only — there is
 * no update/transition behavior to share with the request repository's
 * own conventions.
 */
export interface LogisticsOptimizationResultRecord {
  id: string;
  logisticsRequestId: string;
  recommendedQuoteId: string | null;
  algorithmVersion: string;
  calculatedAt: Date;
  weights: unknown;
  rankings: unknown;
  createdAt: Date;
}

export class LogisticsOptimizationResultRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(logisticsRequestId: string, result: OptimizationResult): Promise<LogisticsOptimizationResultRecord> {
    return this.prisma.logisticsOptimizationResult.create({
      data: {
        logisticsRequestId,
        recommendedQuoteId: result.recommendedQuoteId,
        algorithmVersion: result.algorithmVersion,
        weights: result.weights as object,
        rankings: result.rankings as unknown as object,
      },
    });
  }

  findLatestByRequestId(logisticsRequestId: string): Promise<LogisticsOptimizationResultRecord | null> {
    return this.prisma.logisticsOptimizationResult.findFirst({
      where: { logisticsRequestId },
      orderBy: { calculatedAt: "desc" },
    });
  }
}
