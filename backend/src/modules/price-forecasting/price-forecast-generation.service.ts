import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import { BaselineForecastEngine } from "./price-forecasting.engine";
import { BASELINE_MODEL_PROVIDER, BASELINE_MODEL_VERSION } from "./price-forecasting.engine.types";
import { PriceForecastRepository } from "./price-forecasting.repository";
import { ForecastHorizon, ForecastScope, PersistedForecast } from "./price-forecasting.types";
import { PriceHistoryPreparationService } from "./price-history-preparation.service";

/** What a caller asks this service to produce — deliberately its own
 *  (lighter) shape rather than Part 1's `ForecastInput`: that type
 *  requires the caller to already know `inputDataStartDate`/
 *  `inputDataEndDate`, which is exactly what
 *  `PriceHistoryPreparationService.prepare()` resolves *for* a caller
 *  (defaulting/clamping against `PRICE_FORECAST_CONFIG` when omitted —
 *  see `PriceHistoryRequest`). `startDate`/`endDate` here are forwarded
 *  to that same resolution, not required up front. */
export interface GenerateForecastInput {
  cropId: string;
  scope: ForecastScope;
  targetDate: Date;
  /** Defaults to `PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS`. */
  horizonDays?: ForecastHorizon;
  /** Forwarded to `PriceHistoryPreparationService.prepare()` — see that
   *  method's own defaulting/clamping behavior. Optional; most callers
   *  should omit these and let history preparation pick sensible
   *  defaults. */
  historyStartDate?: Date;
  historyEndDate?: Date;
}

/**
 * Module 7 Part 3 — orchestrates the baseline forecast generation flow:
 * resolve scope/history, check sufficiency, generate the deterministic
 * forecast, and persist it via the existing `PriceForecastRepository`
 * lifecycle. Mirrors `SellStoreOrchestrationService` (Module 8): this
 * class coordinates the established preparation service and engine, it
 * contains no forecasting math of its own.
 */
export class PriceForecastGenerationService {
  constructor(
    private readonly preparation: PriceHistoryPreparationService,
    private readonly engine: BaselineForecastEngine,
    private readonly repository: PriceForecastRepository,
  ) {}

  async generateForecast(input: GenerateForecastInput): Promise<PersistedForecast> {
    const horizonDays: ForecastHorizon = input.horizonDays ?? PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS;

    // 1/4. Resolve scope + create-or-retrieve the idempotent GENERATING
    // record for this (crop, scope, target date, model version) —
    // repeated calls for the same tuple never create a duplicate
    // forecast (build spec section 13; enforced by the repository's own
    // upsert-on-conflict, see its own comment).
    const pending = await this.repository.createOrGetGeneratingForecast({
      cropId: input.cropId,
      scope: input.scope,
      targetDate: input.targetDate,
      horizonDays,
      modelProvider: BASELINE_MODEL_PROVIDER,
      modelVersion: BASELINE_MODEL_VERSION,
    });

    // A prior call already carried this exact forecast to a terminal
    // state (COMPLETED, FAILED, or INSUFFICIENT_DATA) — return it as-is
    // rather than recomputing. Idempotency, not caching: this is the
    // same row a second identical request would otherwise conflict on.
    if (pending.status !== "GENERATING") {
      return pending;
    }

    try {
      // 2. Prepare history (reuses Part 2 verbatim — no duplicated
      // aggregation/sufficiency logic here).
      const history = await this.preparation.prepare({
        cropId: input.cropId,
        scope: input.scope,
        startDate: input.historyStartDate,
        endDate: input.historyEndDate,
        horizonDays,
      });

      // 3/5. Check sufficiency (via the engine, which reuses
      // `history.sufficient` rather than re-deriving it) and generate.
      const result = this.engine.generate(history, horizonDays);

      // 7. Insufficient data is a normal domain outcome, never an
      // exception — persist it as such rather than fabricating a
      // prediction (build spec section 9).
      if (result.outcome === "INSUFFICIENT_DATA") {
        return await this.repository.markInsufficientData(pending.id, result.reasons);
      }

      // 6. Persist the completed forecast.
      const generatedAt = new Date();
      const expiresAt = new Date(generatedAt.getTime() + PRICE_FORECAST_CONFIG.FRESHNESS_DURATION_HOURS * 3_600_000);

      return await this.repository.completeForecast(pending.id, {
        output: result.output,
        confidence: result.confidence,
        model: {
          modelProvider: BASELINE_MODEL_PROVIDER,
          modelVersion: BASELINE_MODEL_VERSION,
          inputDataStartDate: history.windowStartDate,
          inputDataEndDate: history.windowEndDate,
          generatedAt,
          expiresAt,
          metadata: result.modelMetadata as unknown as Record<string, unknown>,
        },
      });
    } catch (error) {
      // 8. Anything unexpected (a database error, a thrown
      // ValidationError from an inverted history window, etc.) marks the
      // pending record FAILED rather than leaving it stuck GENERATING —
      // mirrors SellStoreOrchestrationService's own catch block.
      await this.repository.failForecast(pending.id, [
        error instanceof Error ? error.message : "UNEXPECTED_FORECAST_GENERATION_ERROR",
      ]);
      throw error;
    }
  }
}
