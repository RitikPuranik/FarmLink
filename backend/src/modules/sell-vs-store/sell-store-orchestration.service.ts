import { Prisma, SellStoreDecision } from "@prisma/client";
import { NotFoundError } from "../../common/errors";
import { CropLotRepository } from "../lots/lots.repository";
import { SellStoreDecisionRepository } from "./sell-vs-store.repository";
import { DecisionInputResolverService } from "./sell-store-input-resolver.service";
import { DecisionEngineService } from "./sell-store-decision-engine.service";
import { SellStoreDecisionDTO, DecisionMetadata } from "./sell-store-orchestration.types";
import { SellStoreInputSnapshot } from "./sell-vs-store.types";

/**
 * Orchestrates the Sell vs Store decision flow.
 * Coordinates input resolution, engine evaluation, and lifecycle persistence.
 *
 * Excludes duplicated analytics logic, using the established resolver and engine.
 */
export class SellStoreOrchestrationService {
  constructor(
    private readonly lots: CropLotRepository,
    private readonly repository: SellStoreDecisionRepository,
    private readonly resolver: DecisionInputResolverService,
    private readonly engine: DecisionEngineService
  ) {}

  /**
   * Generates and persists a new Sell vs Store decision for a lot.
   */
  async generateDecision(lotPublicId: string, requestedByUserId: string | null = null): Promise<SellStoreDecisionDTO> {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    // 1. Resolve inputs
    const resolvedInput = await this.resolver.resolveDecisionInputs(lotPublicId);

    // 2. Create PENDING decision record
    const pendingDecision = await this.repository.createDecision(
      lot.id,
      lot.cropId,
      requestedByUserId,
      resolvedInput.snapshot,
      resolvedInput.timestamps.marketDataTimestamp,
      resolvedInput.timestamps.storageDataTimestamp
    );

    try {
      // 3. Evaluate deterministic logic
      const result = this.engine.evaluate(resolvedInput);

      // 4. Construct decision metadata (V1 engine)
      const metadata: DecisionMetadata = {
        engineVersion: "v1",
        factorsUsed: result.factorsUsed,
        omittedFactors: result.omittedFactors,
        insufficiencyReasons: result.insufficiencyReasons,
        sellScore: result.sellScore,
        storeScore: result.storeScore,
      };

      // 5. Mark as COMPLETED and persist final result and snapshot
      const completed = await this.repository.completeDecision(
        pendingDecision.id,
        result.result,
        result.confidence,
        resolvedInput.snapshot as unknown as Prisma.InputJsonValue,
        metadata as unknown as Prisma.InputJsonValue,
        resolvedInput.timestamps.marketDataTimestamp,
        resolvedInput.timestamps.storageDataTimestamp
      );

      return this.mapToDTO(completed);
    } catch (error) {
      // Handle unexpected operational failures (e.g. database disconnect)
      await this.repository.failDecision(pendingDecision.id);
      throw error;
    }
  }

  /**
   * Retrieves a historical decision by its public ID.
   * Does NOT recompute.
   */
  async getDecisionByPublicId(publicId: string): Promise<SellStoreDecisionDTO> {
    const decision = await this.repository.findByPublicId(publicId);
    if (!decision) throw new NotFoundError("Decision not found.");
    return this.mapToDTO(decision);
  }

  /**
   * Retrieves all historical COMPLETED decisions for a lot.
   */
  async getDecisionsForLot(lotPublicId: string): Promise<SellStoreDecisionDTO[]> {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const decisions = await this.repository.listByLotId(lot.id);
    return decisions.map(d => this.mapToDTO(d));
  }

  /**
   * Maps a Prisma raw record to the application DTO.
   */
  private mapToDTO(decision: SellStoreDecision): SellStoreDecisionDTO {
    return {
      publicId: decision.publicId,
      lotId: decision.lotId,
      cropId: decision.cropId,
      requestedByUserId: decision.requestedByUserId,
      status: decision.status,
      result: decision.result,
      confidenceScore: decision.confidenceScore ? Number(decision.confidenceScore) : null,
      inputSnapshot: decision.inputSnapshot ? (decision.inputSnapshot as unknown as SellStoreInputSnapshot) : null,
      decisionMetadata: decision.decisionMetadata ? (decision.decisionMetadata as unknown as DecisionMetadata) : null,
      marketDataTimestamp: decision.marketDataTimestamp,
      storageDataTimestamp: decision.storageDataTimestamp,
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
    };
  }
}
