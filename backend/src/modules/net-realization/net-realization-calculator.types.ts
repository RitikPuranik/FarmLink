import { RealizationCompleteness } from "@prisma/client";
import {
  CostComponent,
  NetRealizationExplanation,
  UnavailableCostComponent,
} from "./net-realization.types";

export type NetRealizationWarning =
  | "SALE_PRICE_UNAVAILABLE"
  | "TRANSPORT_COST_UNAVAILABLE"
  | "LOADING_COST_UNAVAILABLE"
  | "UNLOADING_COST_UNAVAILABLE"
  | "PACKAGING_COST_UNAVAILABLE"
  | "STORAGE_COST_UNAVAILABLE"
  | "COMMISSION_UNKNOWN"
  | "MARKET_FEES_UNKNOWN"
  | "TAX_UNKNOWN"
  | "INSURANCE_UNKNOWN"
  | "OTHER_COST_UNAVAILABLE"
  | "PARTIAL_REALIZATION"
  | "SALE_QUANTITY_UNAVAILABLE";

/**
 * Part E/F output. `grossRevenue`/`netRealization` are `null` whenever
 * the engine never had a valid sale price and quantity to multiply in the
 * first place (INSUFFICIENT) — never `0`, which would misrepresent "we
 * don't know" as "the farmer gets nothing".
 */
export interface CalculationEngineResult {
  grossRevenue: number | null;
  totalKnownCosts: number | null;
  totalEstimatedCosts: number | null;
  totalUserProvidedCosts: number | null;
  totalDeductions: number | null;
  netRealization: number | null;

  completeness: RealizationCompleteness;
  dataCompletenessScore: number | null;

  includedComponents: CostComponent[];
  omittedComponents: UnavailableCostComponent[];

  warnings: NetRealizationWarning[];
  explanation: NetRealizationExplanation;
}
