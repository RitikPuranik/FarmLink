import { QuantityUnit } from "@prisma/client";

// ---------------------------------------------------------------------------
// Module 9 Part 6 — the clean integration boundary Module 8's Sell vs
// Store Decision Engine is meant to depend on, so it never needs to know
// about warehouse query details, suitability weights, ranking logic, or
// Prisma models. Module 9 (this file's WarehouseStorageIntelligenceProvider,
// in storage-intelligence-provider.service.ts) is the only implementation
// that touches real warehouse data; Module 8 only ever sees this
// interface and the plain StorageDecisionContext it returns.
//
// IMPORTANT — read before wiring this into Module 8:
// This repository excerpt does not include Module 8's actual source
// (DecisionInputResolverService, DecisionEngineService,
// SellStoreInputSnapshot, ResolvedDecisionInput,
// SellStoreOrchestrationService) — only app.ts's import/construction
// lines for them are visible. Editing those files' internals from a
// guess at their structure would risk silently breaking real,
// unverifiable code, which this module's own conventions
// ("the actual repository implementation is the source of truth", "do
// not fabricate") rule out. This file, its implementation, and its
// tests are complete and real; the Module 8-side wiring is documented
// as exact, minimal instructions in this module's documentation instead
// of being applied blind. See the "Module 8 integration — what to change,
// exactly" section in docs/modules/module-09-warehouse-intelligence.md.
// ---------------------------------------------------------------------------

export interface StorageContextRequest {
  cropId: string;
  quantity?: number;
  unit?: QuantityUnit;
  durationDays?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  /** Module 8 always evaluates storage on behalf of a specific
   * requesting user (the lot's farmer, or the FPO/admin acting for
   * them) — Module 9's own suitability/recommendation services enforce
   * the same warehouse-visibility rules used everywhere else in this
   * module (see WarehouseAvailabilityService's isWarehouseVisibleTo()),
   * so a caller identity is required, never bypassed. */
  requestingUser: { id: string; role: string };
}

/**
 * Normalized, Module-8-facing storage context (build spec's own
 * contract, adapted only in that risks/constraints are plain string
 * codes rather than full WarehouseRisk/WarehouseConstraint objects —
 * Module 8 doesn't need severity/blocking detail, only the codes, per
 * this part's own "do not expose full warehouse Prisma models" and
 * general "normalized, minimal" framing). Every field can be `null`;
 * `null` always means "could not be determined from real data", never
 * "assume the best/worst case".
 */
export interface StorageDecisionContext {
  /**
   * `true`: at least one warehouse is confirmed SUITABLE or
   * CONDITIONALLY_SUITABLE for this crop/quantity/location right now.
   * `false`: storage was evaluated and no warehouse qualifies (every
   * discovered candidate was UNSUITABLE, or no candidate warehouse
   * exists for this crop at all).
   * `null`: could not be reliably evaluated (e.g. every candidate
   * returned UNKNOWN/insufficient data). Never conflate `false` and
   * `null` — see this part's own "do not convert unknown into false"
   * rule.
   */
  availability: boolean | null;

  suitableWarehouseCount: number;

  bestWarehouseAvailable: {
    warehousePublicId: string;
    name: string;
    distanceKm: number | null;
    suitabilityScore: number | null;
  } | null;

  estimatedCost: number | null;
  costPerUnit: number | null;
  currency: string | null;

  /** Only populated when a specific duration was requested and no
   * duration-limit risk applied to the best candidate — see
   * resolveStorageContext()'s own comment. Never a fabricated default
   * duration. */
  feasibleDurationDays: number | null;

  /** Risk/constraint codes only (e.g. "LIMITED_CAPACITY",
   * "ENVIRONMENTAL_DATA_UNKNOWN") — see warehouse-risk-analysis.types.ts
   * for the full code list this draws from. */
  risks: string[];
  constraints: string[];

  confidence: number | null;
  dataTimestamp: string;

  factorsUsed: string[];
  omittedFactors: string[];
}

/**
 * The provider boundary Module 8's DecisionInputResolverService should
 * depend on (constructor-injected), never a concrete Module 9 class
 * directly — this is what keeps Module 8 free of any warehouse-query or
 * Prisma-model knowledge, and is what makes
 * UnavailableStorageIntelligenceProvider a safe drop-in when Module 9
 * isn't wired into a given environment.
 */
export interface StorageIntelligenceProvider {
  resolveStorageContext(request: StorageContextRequest): Promise<StorageDecisionContext>;
}

/** The honest, fully-unknown context: every field null/empty/zero,
 * `availability: null` (never `false` — an unavailable *provider* is not
 * the same fact as "evaluated and found no storage", and must not be
 * reported as if it were). Mirrors this exact codebase's own established
 * pattern for an optional integration with no real backend wired yet —
 * see UnavailableSellStoreAIProvider/UnavailableQualityAIProvider's
 * naming and role (visible via app.ts's own comments on them), which
 * this class deliberately follows.
 */
export class UnavailableStorageIntelligenceProvider implements StorageIntelligenceProvider {
  async resolveStorageContext(_request: StorageContextRequest): Promise<StorageDecisionContext> {
    return {
      availability: null,
      suitableWarehouseCount: 0,
      bestWarehouseAvailable: null,
      estimatedCost: null,
      costPerUnit: null,
      currency: null,
      feasibleDurationDays: null,
      risks: [],
      constraints: [],
      confidence: null,
      dataTimestamp: new Date().toISOString(),
      factorsUsed: [],
      omittedFactors: [],
    };
  }
}
