import { PrismaClient, PriceForecastScopeType } from "@prisma/client";
import { MarketDomainError, NotFoundError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { MarketIntelligenceRepository } from "../market-intelligence/market-intelligence.repository";
import { getForecastCache, invalidateForecastCache, setForecastCache } from "./price-forecasting.cache";
import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import { assertGeneratedForecastIsSane, ForecastMandiDTO, ForecastResponseDTO, toForecastResponseDTO } from "./price-forecasting.dto";
import { BASELINE_MODEL_VERSION } from "./price-forecasting.engine.types";
import { PriceForecastGenerationService } from "./price-forecast-generation.service";
import { PriceForecastRepository } from "./price-forecasting.repository";
import { ForecastHorizon, ForecastScope, PersistedForecast } from "./price-forecasting.types";

// ---------------------------------------------------------------------------
// Module 7 Part 4 — application orchestration layer.
//
// This is the layer the build spec's Part 4 describes as connecting
// "Historical Data Preparation -> Data Sufficiency -> Existing Forecast
// Algorithm -> Forecast Persistence -> Historical Forecast Retrieval".
// That entire chain already exists and is NOT duplicated here:
//   - Historical Data Preparation + Data Sufficiency: PriceHistoryPreparationService (Part 2)
//   - Forecast Algorithm: BaselineForecastEngine (Part 3)
//   - Forecast Persistence lifecycle (GENERATING -> COMPLETED/FAILED/INSUFFICIENT_DATA),
//     including the idempotent upsert that already prevents duplicate
//     forecasts for the same (crop, scope, targetDate, modelVersion):
//     PriceForecastGenerationService (Part 3)
// This service's own job is everything Part 3 correctly left out because
// it belongs at the application boundary, not inside a pure/deterministic
// forecasting pipeline: crop/mandi existence validation, translating
// between a client-facing Mandi.publicId and the internal Mandi.id
// PriceForecast/MandiPrice key off, computing a target date from a
// requested horizon, output sanity-checking, DTO mapping, caching,
// analytics, and audit logging.
// ---------------------------------------------------------------------------

/** Client-facing scope shape — MANDI's `mandiId` is `Mandi.publicId`
 *  (never the internal `Mandi.id` Part 1-3 use internally). Kept distinct
 *  from `ForecastScope` (price-forecasting.types.ts) specifically so this
 *  boundary is a type-level fact, not just a comment. */
export type ClientForecastScope =
  | { type: "MANDI"; mandiId: string }
  | { type: "REGIONAL"; state: string; district?: string }
  | { type: "CROP_WIDE" };

export interface GenerateForecastServiceInput {
  cropId: string;
  scope: ClientForecastScope;
  horizonDays?: ForecastHorizon;
}

export interface ListForecastsFilter {
  scopeType?: PriceForecastScopeType;
  /** Mandi.publicId — resolved to the internal id before querying. */
  mandiId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, days: number) => {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export class PriceForecastingService {
  constructor(
    private readonly generation: PriceForecastGenerationService,
    private readonly repository: PriceForecastRepository,
    /** Reused for crop/mandi lookups — build spec: "Module 7 must
     *  integrate with Module 6 ... reuse Market Intelligence historical
     *  patterns," and this is the exact same instance app.ts already
     *  shares with Module 8's DecisionInputResolverService. */
    private readonly marketIntelligence: MarketIntelligenceRepository,
    /** Only for the one batched Mandi lookup list results need to avoid
     *  N+1 (see resolveMandisBatch) — every other query goes through the
     *  repositories above. */
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  // ── Crop / scope resolution ─────────────────────────────────────────

  private async requireCrop(cropId: string): Promise<{ id: string; name: string }> {
    const crop = await this.marketIntelligence.crop(cropId);
    if (!crop) throw new MarketDomainError("Crop not found.", "CROP_NOT_FOUND", 404);
    return crop;
  }

  /** Best-effort crop lookup for DTO display on an *already-persisted*
   *  forecast (getForecast) — a missing crop here would be a display
   *  hiccup, never a reason to 404 a perfectly valid forecast (the
   *  `onDelete: Restrict` FK means this should be unreachable in
   *  practice anyway). */
  private async resolveCropForDisplay(cropId: string): Promise<{ id: string; name: string }> {
    const crop = await this.marketIntelligence.crop(cropId);
    return crop ?? { id: cropId, name: "Unknown crop" };
  }

  private async resolveScope(scope: ClientForecastScope): Promise<{ internalScope: ForecastScope; mandi: ForecastMandiDTO | null }> {
    if (scope.type === "MANDI") {
      const mandi = await this.marketIntelligence.mandi(scope.mandiId);
      if (!mandi) throw new MarketDomainError("Mandi not found.", "MANDI_NOT_FOUND", 404);
      return {
        internalScope: { type: "MANDI", mandiId: mandi.id },
        mandi: { publicId: mandi.publicId, name: mandi.name, state: mandi.state, district: mandi.district },
      };
    }
    if (scope.type === "REGIONAL") {
      return { internalScope: { type: "REGIONAL", state: scope.state, district: scope.district }, mandi: null };
    }
    return { internalScope: { type: "CROP_WIDE" }, mandi: null };
  }

  private async resolveMandiById(mandiId: string): Promise<ForecastMandiDTO | null> {
    const row = await this.prisma.mandi.findUnique({
      where: { id: mandiId },
      select: { publicId: true, name: true, state: true, district: true },
    });
    return row ? { publicId: row.publicId, name: row.name, state: row.state, district: row.district } : null;
  }

  /** One batched query for every distinct MANDI referenced across a list
   *  of forecasts — the N+1 this module was explicitly told to avoid. */
  private async resolveMandisBatch(forecasts: PersistedForecast[]): Promise<Map<string, ForecastMandiDTO>> {
    const ids = [...new Set(forecasts.filter((f) => f.scope.type === "MANDI").map((f) => (f.scope as { mandiId: string }).mandiId))];
    if (!ids.length) return new Map();
    const rows = await this.prisma.mandi.findMany({
      where: { id: { in: ids } },
      select: { id: true, publicId: true, name: true, state: true, district: true },
    });
    return new Map(
      rows.map((m: { id: string; publicId: string; name: string; state: string; district: string }) => [
        m.id,
        { publicId: m.publicId, name: m.name, state: m.state, district: m.district },
      ]),
    );
  }

  /** An existing, already-terminal (not GENERATING) forecast for the
   *  exact same (cropId, scope, targetDate, current model version), if
   *  one exists — the "equivalent valid forecast" build spec Part 4 step
   *  4 asks to check for. Filters by model version defensively (today
   *  there is only one, BASELINE_MODEL_VERSION) so a future Part 4+
   *  algorithm under a different version is never mistaken for a match. */
  private async findExactMatch(cropId: string, scope: ForecastScope, targetDate: Date): Promise<PersistedForecast | null> {
    const candidates = await this.repository.findByDateRange(cropId, scope, targetDate, targetDate);
    return candidates.find((f) => f.model.modelVersion === BASELINE_MODEL_VERSION && f.status !== "GENERATING") ?? null;
  }

  // ── Generate ─────────────────────────────────────────────────────────

  async generateForecast(input: GenerateForecastServiceInput, actor: AuthenticatedUserContext): Promise<ForecastResponseDTO> {
    const crop = await this.requireCrop(input.cropId);
    const { internalScope, mandi } = await this.resolveScope(input.scope);
    const horizonDays: ForecastHorizon = input.horizonDays ?? PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS;
    const targetDate = addDays(startOfDay(new Date()), horizonDays);

    trackEvent("forecast_requested", actor.id, { cropId: crop.id, scopeType: internalScope.type, horizonDays });

    // Fast path — avoid recomputation entirely when an equivalent forecast
    // already reached a terminal state (build spec step 4). The
    // underlying idempotent upsert (Part 3) would land on the same row
    // regardless, but checking first here also lets "reused" stay
    // observably distinct from "freshly generated" for analytics, without
    // running PriceHistoryPreparationService/the engine again.
    const existing = await this.findExactMatch(crop.id, internalScope, targetDate);
    let persisted: PersistedForecast;

    if (existing) {
      persisted = existing;
      trackEvent(existing.status === "INSUFFICIENT_DATA" ? "forecast_insufficient_data" : "forecast_reused", actor.id, {
        cropId: crop.id,
        scopeType: internalScope.type,
        forecastPublicId: existing.publicId,
        status: existing.status,
      });
    } else {
      try {
        persisted = await this.generation.generateForecast({ cropId: crop.id, scope: internalScope, targetDate, horizonDays });
      } catch (error) {
        trackEvent("forecast_failed", actor.id, { cropId: crop.id, scopeType: internalScope.type, horizonDays });
        throw error;
      }

      // Defense-in-depth (build spec step 9) — see assertGeneratedForecastIsSane's own comment.
      assertGeneratedForecastIsSane(persisted, horizonDays);

      if (persisted.status === "COMPLETED") {
        trackEvent("forecast_generated", actor.id, { cropId: crop.id, scopeType: internalScope.type, forecastPublicId: persisted.publicId });
        await this.audit.record({
          actorUserId: actor.id,
          action: "PRICE_FORECAST_GENERATED",
          entityType: "PriceForecast",
          entityId: persisted.id,
          metadata: { cropId: crop.id, scopeType: internalScope.type, horizonDays },
        });
        await invalidateForecastCache();
      } else if (persisted.status === "INSUFFICIENT_DATA") {
        trackEvent("forecast_insufficient_data", actor.id, { cropId: crop.id, scopeType: internalScope.type, horizonDays });
        await invalidateForecastCache();
      }
      // FAILED is unreachable here without a throw (generateForecast
      // rethrows on failure — see the catch block above), so no branch
      // for it is needed.
    }

    return toForecastResponseDTO(persisted, crop, mandi);
  }

  // ── Read ─────────────────────────────────────────────────────────────

  /** Retrieves a persisted forecast exactly as it was resolved. Never
   *  recomputes — historical forecasts are immutable (build spec Part 5). */
  async getForecast(publicId: string): Promise<ForecastResponseDTO> {
    const forecast = await this.repository.findByPublicId(publicId);
    if (!forecast) throw new NotFoundError("Forecast not found.");

    const crop = await this.resolveCropForDisplay(forecast.cropId);
    const mandi = forecast.scope.type === "MANDI" ? await this.resolveMandiById(forecast.scope.mandiId) : null;
    return toForecastResponseDTO(forecast, crop, mandi);
  }

  async listForecasts(cropId: string, filters: ListForecastsFilter): Promise<ForecastResponseDTO[]> {
    const crop = await this.requireCrop(cropId);

    let internalMandiId: string | undefined;
    if (filters.mandiId) {
      const mandi = await this.marketIntelligence.mandi(filters.mandiId);
      if (!mandi) throw new MarketDomainError("Mandi not found.", "MANDI_NOT_FOUND", 404);
      internalMandiId = mandi.id;
    }

    const cacheKey = [crop.id, filters];
    const cached = await getForecastCache<ForecastResponseDTO[]>("list", cacheKey);
    if (cached) return cached;

    // Bounded either way (both repository methods cap `take` — see
    // MAX_LIST_RESULTS). The mandi-specific path is a single indexed SQL
    // filter; scopeType/date-range refine the already-bounded result set
    // in memory rather than adding new repository query shapes (Part 1's
    // repository is not redesigned for this).
    let forecasts: PersistedForecast[];
    if (internalMandiId) {
      forecasts = await this.repository.listForCropAndMandi(crop.id, internalMandiId, { limit: filters.limit });
    } else {
      forecasts = await this.repository.listForCrop(crop.id, { limit: filters.limit });
      if (filters.scopeType) forecasts = forecasts.filter((f) => f.scope.type === filters.scopeType);
    }
    if (filters.startDate) forecasts = forecasts.filter((f) => f.targetDate >= filters.startDate!);
    if (filters.endDate) forecasts = forecasts.filter((f) => f.targetDate <= filters.endDate!);

    const mandiMap = await this.resolveMandisBatch(forecasts);
    const dtos = forecasts.map((f) =>
      toForecastResponseDTO(f, crop, f.scope.type === "MANDI" ? mandiMap.get(f.scope.mandiId) ?? null : null),
    );

    await setForecastCache("list", cacheKey, dtos);
    return dtos;
  }

  async findLatestForecast(cropId: string, scope: ClientForecastScope): Promise<ForecastResponseDTO> {
    const crop = await this.requireCrop(cropId);
    const { internalScope, mandi } = await this.resolveScope(scope);

    const cacheKey = [crop.id, internalScope];
    const cached = await getForecastCache<ForecastResponseDTO>("latest", cacheKey);
    if (cached) return cached;

    const forecast = await this.repository.findLatestValid(crop.id, internalScope);
    if (!forecast) throw new NotFoundError("No valid forecast is available yet for this crop and scope.");

    const dto = toForecastResponseDTO(forecast, crop, mandi);
    await setForecastCache("latest", cacheKey, dto);
    return dto;
  }
}
