import { PrismaClient, Prisma, SellStoreDecision, SellStoreDecisionResult } from "@prisma/client";
import { SellStoreInputSnapshot } from "./sell-vs-store.types";

// Module 8 Part 7: a lot can accumulate one decision per /analyze call, and
// unlike other list endpoints in this codebase (lots, quality assessments,
// FPO membership — see their page/limit query params) this endpoint has no
// pagination contract for callers to opt into yet (see
// docs/modules/module-08-sell-vs-store.md's "Known limitations"). This cap
// is a defensive backstop against an unbounded query for a very
// long-lived/frequently-analyzed lot; it is intentionally generous so no
// realistic lot's history is truncated today.
const MAX_HISTORY_RESULTS = 200;

export class SellStoreDecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createDecision(
    lotId: string,
    cropId: string,
    requestedByUserId: string | null,
    snapshot: SellStoreInputSnapshot,
    marketDataTimestamp: Date | null,
    storageDataTimestamp: Date | null
  ): Promise<SellStoreDecision> {
    return this.prisma.sellStoreDecision.create({
      data: {
        lotId,
        cropId,
        requestedByUserId,
        status: "PENDING",
        inputSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        marketDataTimestamp,
        storageDataTimestamp,
      },
    });
  }

  async getDecision(id: string): Promise<SellStoreDecision | null> {
    return this.prisma.sellStoreDecision.findUnique({
      where: { id },
    });
  }

  async findByPublicId(publicId: string): Promise<SellStoreDecision | null> {
    return this.prisma.sellStoreDecision.findUnique({
      where: { publicId },
    });
  }

  async listByLotId(lotId: string): Promise<SellStoreDecision[]> {
    return this.prisma.sellStoreDecision.findMany({
      where: { lotId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: MAX_HISTORY_RESULTS,
    });
  }

  async completeDecision(
    id: string,
    result: SellStoreDecisionResult,
    confidenceScore: number,
    inputSnapshot: Prisma.InputJsonValue,
    decisionMetadata: Prisma.InputJsonValue,
    marketDataTimestamp: Date | null,
    storageDataTimestamp: Date | null
  ): Promise<SellStoreDecision> {
    return this.prisma.sellStoreDecision.update({
      where: { id },
      data: {
        status: "COMPLETED",
        result,
        confidenceScore,
        inputSnapshot,
        decisionMetadata,
        marketDataTimestamp,
        storageDataTimestamp,
      },
    });
  }

  async failDecision(id: string): Promise<SellStoreDecision> {
    return this.prisma.sellStoreDecision.update({
      where: { id },
      data: { status: "FAILED" },
    });
  }
}
