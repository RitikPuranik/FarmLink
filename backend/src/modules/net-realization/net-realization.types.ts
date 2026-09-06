import {
  NetRealizationCostCategory,
  NetRealizationPriceSourceType,
  NetRealizationStatus,
  QuantityUnit,
  RealizationCompleteness,
  RealizationValueSource,
} from "@prisma/client";

/**
 * Part C — Calculation Input Contract.
 *
 * This is the clean, module-internal shape the resolver builds and the
 * pure engine consumes. It never leaks a raw Prisma model, and every
 * monetary/quantity field is a plain `number` here (Decimal is only used
 * at the Prisma boundary — see net-realization.repository.ts) since the
 * engine itself does its arithmetic with the project's Decimal-safe
 * helper (see net-realization-calculator.math.ts), not native floats.
 */
export interface NetRealizationLotContext {
  lotId: string;
  lotPublicId: string;
  cropId: string;
  cropName: string;
  /** Always the lot's own canonical KG quantity (build spec section
   * 11/65 — CropLot.availableQuantityKg is the single source of truth),
   * never re-derived from a display unit. */
  availableQuantityKg: number;
}

/** Part C's `CostComponent` — one resolved (or user-supplied) cost line. */
export interface CostComponent {
  category: NetRealizationCostCategory;
  /** Free-text label for OTHER components; ignored for named categories
   * (their category name is the label). */
  name?: string;
  amount: number;
  source: RealizationValueSource;
  /** True when this cost is already netted into the resolved sale price
   * (e.g. an offer price quoted "delivered" / net-of-commission) and so
   * must NOT also be subtracted separately — see the engine's own guard. */
  isIncludedInPrice?: boolean;
}

export interface UnavailableCostComponent {
  category: NetRealizationCostCategory;
  reason: string;
}

export interface NetRealizationPriceSource {
  type: NetRealizationPriceSourceType;
  /** TradeOffer.publicId when type is ACCEPTED_OFFER/OFFER; null
   * otherwise (build spec Part C example: `priceSource.referenceId`). */
  referenceId: string | null;
  valueSource: RealizationValueSource;
}

/** Part C's `NetRealizationInput` — the immutable, fully-resolved
 * snapshot the engine evaluates and the repository persists verbatim as
 * `inputSnapshot`. */
export interface NetRealizationInput {
  lot: NetRealizationLotContext;

  sale: {
    pricePerUnit: number | null;
    /** The unit `pricePerUnit` is denominated in — always the unit the
     * resolved price source itself quoted (an offer's own quantityUnit,
     * or KG for a market-reference/user-provided price), never silently
     * reinterpreted. */
    priceUnit: QuantityUnit | null;
    quantity: number | null;
    quantityUnit: QuantityUnit | null;
    source: NetRealizationPriceSource;
  };

  costs: {
    resolved: CostComponent[];
    unavailable: UnavailableCostComponent[];
  };
}

export interface NetRealizationExplanation {
  includedFactors: string[];
  omittedFactors: string[];
  assumptions: string[];
  warnings: string[];
  disclaimer: string;
}

export interface NetRealizationMetadata {
  calculationVersion: string;
  includedComponents: CostComponent[];
  omittedComponents: UnavailableCostComponent[];
  explanation: NetRealizationExplanation;
}

export interface NetRealizationDTO {
  publicId: string;
  /** Internal lot ID — kept on the DTO the same way SellStoreDecisionDTO
   * exposes it, so the controller can authorize a historical lookup
   * (GET /:publicId) against the owning lot without a second, redundant
   * repository call inside the orchestration layer itself (Part J: only
   * the controller does authorization in this module). */
  lotId: string;
  lotPublicId: string;
  status: NetRealizationStatus;
  currency: string;

  sale: {
    pricePerUnit: number | null;
    priceUnit: QuantityUnit | null;
    quantity: number | null;
    quantityUnit: QuantityUnit | null;
    grossRevenue: number | null;
    source: NetRealizationPriceSource;
  };

  costs: {
    included: Array<{ category: NetRealizationCostCategory; name?: string; amount: number; source: RealizationValueSource }>;
    unavailable: UnavailableCostComponent[];
    totals: {
      known: number | null;
      estimated: number | null;
      userProvided: number | null;
    };
  };

  result: {
    netRealization: number | null;
    completeness: RealizationCompleteness | null;
    dataCompletenessScore: number | null;
  };

  explanation: NetRealizationExplanation | null;

  metadata: {
    calculationVersion: string | null;
    calculatedAt: string;
  };

  inputSnapshot: NetRealizationInput | null;

  createdAt: Date;
  updatedAt: Date;
}
