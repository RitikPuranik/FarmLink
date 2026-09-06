import { NetRealizationCostCategory } from "@prisma/client";

/**
 * Part N — a single centralized disclaimer, never scattered as ad-hoc
 * strings through the codebase. Every calculation response (COMPLETED,
 * PARTIAL, or INSUFFICIENT_DATA) includes this verbatim.
 */
export const NET_REALIZATION_DISCLAIMER =
  "Net realization is calculated from currently available price and cost data. " +
  "Unavailable costs are not treated as zero and may change the final amount. " +
  "This calculation is informational and does not guarantee final settlement.";

export const NET_REALIZATION_ENGINE_VERSION = "v1";

/** Human-readable label per category, used only in generated explanation
 * strings (Part G) — never in persisted machine-readable fields. */
export const COST_CATEGORY_LABELS: Record<NetRealizationCostCategory, string> = {
  TRANSPORT: "transport",
  LOADING: "loading",
  UNLOADING: "unloading",
  PACKAGING: "packaging",
  STORAGE: "storage",
  COMMISSION: "commission",
  MARKET_FEE: "market fees",
  TAX: "taxes",
  INSURANCE: "insurance",
  OTHER: "other",
};

/** The named (non-OTHER) cost categories every calculation always
 * evaluates — Part D's fixed category list. `OTHER` is a variable-length
 * array supplied only by the caller, never auto-resolved. */
export const NAMED_COST_CATEGORIES: Exclude<NetRealizationCostCategory, "OTHER">[] = [
  "TRANSPORT",
  "LOADING",
  "UNLOADING",
  "PACKAGING",
  "STORAGE",
  "COMMISSION",
  "MARKET_FEE",
  "TAX",
  "INSURANCE",
];
