import { NetRealizationCostCategory, QuantityUnit } from "@prisma/client";
import { NetRealizationInput } from "./net-realization.types";

/** One caller-supplied cost line for a named category (Part K — "known
 * user-provided costs"). Always labeled USER_PROVIDED by the resolver,
 * never accepted as any other source (Part K's own "must be explicitly
 * labeled USER_PROVIDED" rule) — the request body has no way to claim a
 * value is ACTUAL/ESTIMATED/MARKET_REFERENCE. */
export interface UserProvidedCostInput {
  category: NetRealizationCostCategory;
  amount: number;
  /** Required only for category OTHER — a free-text label so multiple
   * OTHER lines stay distinguishable in the response. */
  name?: string;
  isIncludedInPrice?: boolean;
}

/** Everything a caller may optionally override on a calculation request
 * (Part K's POST body). Every field is optional; the resolver falls back
 * to automatic resolution wherever a field is omitted. */
export interface NetRealizationRequestOverrides {
  /** Calculate against this specific TradeOffer instead of auto-detecting
   * the lot's ACCEPTED offer. Must belong to the lot being calculated. */
  offerPublicId?: string;
  /** A hypothetical/what-if sale price, used only when no offer applies. */
  salePricePerUnit?: number;
  salePriceUnit?: QuantityUnit;
  /** Overrides the quantity being sold; defaults to the resolved price
   * source's own quantity (an offer's quantity) or the lot's full
   * available quantity otherwise. */
  saleQuantity?: number;
  saleQuantityUnit?: QuantityUnit;
  costs?: UserProvidedCostInput[];
}

export interface ResolvedNetRealizationInput {
  lotId: string;
  cropId: string;
  input: NetRealizationInput;
}
