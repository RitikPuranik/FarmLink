import { Prisma, SellStoreDecision } from "@prisma/client";
import { NotFoundError } from "../../common/errors";
import { AuditService } from "../audit/audit.service";
import { CropLotRepository } from "../lots/lots.repository";
import { SellStoreDecisionRepository } from "./sell-vs-store.repository";
import { DecisionInputResolverService } from "./sell-store-input-resolver.service";
import { DecisionEngineService } from "./sell-store-decision-engine.service";
import { ResolvedDecisionInput } from "./sell-store-input-resolver.types";
import { DecisionEngineResult } from "./sell-store-decision-engine.types";
import { SellStoreDecisionDTO, DecisionMetadata } from "./sell-store-orchestration.types";
import { SellStoreInputSnapshot } from "./sell-vs-store.types";
import { SellStoreAIProvider, UnavailableSellStoreAIProvider } from "./ai/sell-store-ai.provider";
import { SellStoreAdvisoryResult, SellStoreAIProviderError } from "./ai/sell-store-ai.types";
import { buildSellStoreAIContext } from "./ai/sell-store-ai-context.builder";
import { parseSellStoreAdvisoryResponse } from "./ai/sell-store-ai-response.schema";
import { trackEvent } from "../../config/posthog";
import { captureException } from "../../config/sentry";

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
    private readonly engine: DecisionEngineService,
    // Module 8 Part 6, build spec section 10: optional and defaults to the
    // honest-unavailable stub, same pattern as QualityService's aiProvider
    // (see app.ts). Existing callers that construct this service with only
    // four arguments keep working unchanged.
    private readonly aiProvider: SellStoreAIProvider = new UnavailableSellStoreAIProvider(),
    // Module 8 Part 7: optional, additive, and defaults to undefined so
    // every existing 4- and 5-argument construction (across app.ts and the
    // test suite) keeps working unchanged. When present, a successfully
    // persisted decision is recorded the same way Module 6's analogous
    // "generated recommendation" action is (MARKET_RECOMMENDATION_GENERATED
    // in market-intelligence.service.ts) — see recordAuditSafely below for
    // why a logging failure can never affect the decision's own status.
    private readonly auditService?: AuditService
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

      // 5b. Record the audit trail entry for this decision. Deliberately
      // placed after completeDecision succeeds and wrapped so it can never
      // throw (see recordAuditSafely) — an audit-logging problem must never
      // downgrade an already-COMPLETED decision to FAILED via the catch
      // block below.
      await this.recordAuditSafely(completed, requestedByUserId, lot.publicId);

      // 6. Attempt AI advisory. Module 8 Part 6, build spec section 7: this
      // only ever runs after the deterministic decision above is already
      // durably persisted, and its outcome (success, failure, or timeout)
      // never feeds back into `completed` — attemptAdvisory never throws,
      // so it can never cause the catch block below to mark this decision
      // FAILED.
      const aiAdvisory = await this.attemptAdvisory(resolvedInput, result, requestedByUserId, lot.publicId);

      return this.mapToDTO(completed, aiAdvisory);
    } catch (error) {
      // Handle unexpected operational failures (e.g. database disconnect)
      await this.repository.failDecision(pendingDecision.id);
      throw error;
    }
  }

  /**
   * Module 8 Part 7: records SELL_STORE_DECISION_GENERATED once a decision
   * has reached COMPLETED. Never throws — an audit-logging failure is
   * captured and reported the same way an AI provider failure is (Sentry,
   * sanitized context only) but must never affect the response or cause
   * the caller's try/catch to mark this already-persisted decision FAILED.
   * No-ops when no AuditService was supplied (backward-compatible
   * construction, see constructor comment).
   */
  private async recordAuditSafely(
    decision: SellStoreDecision,
    requestedByUserId: string | null,
    lotPublicId: string
  ): Promise<void> {
    if (!this.auditService) return;
    try {
      await this.auditService.record({
        actorUserId: requestedByUserId,
        action: "SELL_STORE_DECISION_GENERATED",
        entityType: "SellStoreDecision",
        entityId: decision.publicId,
        metadata: { lotPublicId, result: decision.result },
      });
    } catch (err) {
      captureException(err instanceof Error ? err : new Error("SELL_STORE_DECISION_GENERATED audit logging failed"), {
        lotPublicId,
        decisionPublicId: decision.publicId,
      });
    }
  }

  /**
   * Module 8 Part 6, build spec section 7/12: builds the compact AI
   * context, calls the configured provider, and validates its response —
   * normalizing every possible failure (no provider configured, timeout,
   * quota, network failure, malformed response, schema validation failure)
   * to a single `null` result. This method is deliberately structured so
   * that it can never throw: any error from context building, the
   * provider, or validation is caught here and converted into telemetry
   * plus `null`, never a rethrow.
   */
  private async attemptAdvisory(
    input: ResolvedDecisionInput,
    engineResult: DecisionEngineResult,
    requestedByUserId: string | null,
    lotPublicId: string
  ): Promise<SellStoreAdvisoryResult | null> {
    const distinctId = requestedByUserId ?? "system";

    trackEvent("advisory_requested", distinctId, { lotPublicId, provider: this.aiProvider.name });

    try {
      const context = buildSellStoreAIContext(input, engineResult);
      const raw = await this.aiProvider.analyze(context);
      const advisory = parseSellStoreAdvisoryResponse(raw);

      trackEvent("advisory_success", distinctId, { lotPublicId, provider: this.aiProvider.name });
      return advisory;
    } catch (err) {
      const providerError =
        err instanceof SellStoreAIProviderError
          ? err
          : new SellStoreAIProviderError("AI_ADVISORY_FAILED", "The AI advisory attempt failed unexpectedly.");

      trackEvent("advisory_failed", distinctId, {
        lotPublicId,
        provider: this.aiProvider.name,
        errorCode: providerError.code,
      });
      // Build spec section 12: AI failures stay visible through the
      // existing Sentry pattern even though they never propagate to
      // errorHandler.ts — only the sanitized error code/provider/lotPublicId
      // is attached, never the AI context or provider payload.
      captureException(providerError, {
        lotPublicId,
        provider: this.aiProvider.name,
        errorCode: providerError.code,
      });

      return null;
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
   * Maps a Prisma raw record to the application DTO. `aiAdvisory` defaults
   * to null so every historical-retrieval call site (getDecisionByPublicId,
   * getDecisionsForLot) gets it for free without persisting or
   * reconstructing anything — build spec section 9: historical AI advice
   * is never pretended to exist.
   */
  private mapToDTO(decision: SellStoreDecision, aiAdvisory: SellStoreAdvisoryResult | null = null): SellStoreDecisionDTO {
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
      aiAdvisory,
    };
  }
}
