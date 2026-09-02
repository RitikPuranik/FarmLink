import { PrismaClient, Prisma, SellStoreDecision } from "@prisma/client";
import { SellStoreInputSnapshot } from "./sell-vs-store.types";

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
    });
  }

  async completeDecision(
    id: string,
    result: Prisma.SellStoreDecisionResult,
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
