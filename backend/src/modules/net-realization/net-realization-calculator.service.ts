import { RealizationCompleteness } from "@prisma/client";
import { NetRealizationInput, NetRealizationExplanation } from "./net-realization.types";
import { CalculationEngineResult, NetRealizationWarning } from "./net-realization-calculator.types";
import { Money } from "./net-realization-money";
import { COST_CATEGORY_LABELS, NET_REALIZATION_DISCLAIMER } from "./net-realization.config";

/**
 * Part E — Deterministic Calculation Engine.
 *
 * Pure function of its input: no database calls, no HTTP calls, no clock
 * reads, no randomness. The exact same `NetRealizationInput` always
 * produces the exact same `CalculationEngineResult` (asserted directly in
 * this file's test suite — see "determinism").
 *
 * Formula:
 *   grossRevenue     = salePricePerUnit x saleQuantity
 *   netRealization   = grossRevenue - totalKnownCosts - totalEstimatedCosts
 *                                    - totalUserProvidedCosts
 *
 * Only components whose amount is actually available (ACTUAL, ESTIMATED,
 * USER_PROVIDED, or MARKET_REFERENCE) are ever subtracted. A category with
 * no resolved value is recorded in `omittedComponents` and is never
 * treated as if it were zero (Part E's own explicit rule) — this is the
 * single most important behavior this engine guarantees, and the reason
 * `netRealization` stays `null` rather than becoming a confident-looking
 * number whenever the sale price itself could not be resolved.
 */
export class NetRealizationCalculatorService {
  evaluate(input: NetRealizationInput): CalculationEngineResult {
    const warnings: NetRealizationWarning[] = [];

    const { pricePerUnit, quantity } = input.sale;
    const hasValidPrice = pricePerUnit !== null && pricePerUnit >= 0;
    const hasValidQuantity = quantity !== null && quantity > 0;

    if (!hasValidPrice) warnings.push("SALE_PRICE_UNAVAILABLE");
    if (!hasValidQuantity) warnings.push("SALE_QUANTITY_UNAVAILABLE");

    // INSUFFICIENT: Part F's own rule — sale price unavailable OR quantity
    // unavailable OR invalid inputs means the engine never even attempts
    // gross-revenue arithmetic. A `0` or fabricated placeholder here would
    // be exactly the "convincing financial lie" this module exists to
    // prevent.
    if (!hasValidPrice || !hasValidQuantity) {
      for (const unavailable of input.costs.unavailable) {
        warnings.push(warningForCategory(unavailable.category));
      }
      return {
        grossRevenue: null,
        totalKnownCosts: null,
        totalEstimatedCosts: null,
        totalUserProvidedCosts: null,
        totalDeductions: null,
        netRealization: null,
        completeness: "INSUFFICIENT",
        dataCompletenessScore: null,
        includedComponents: [],
        omittedComponents: input.costs.unavailable,
        warnings: dedupe(warnings),
        explanation: buildExplanation({
          input,
          includedFactors: [],
          netRealization: null,
          completeness: "INSUFFICIENT",
          warnings,
        }),
      };
    }

    const grossRevenueMoney = Money.multiplyRupeesByQuantity(pricePerUnit as number, quantity as number);

    // Costs already netted into the resolved price (isIncludedInPrice)
    // are recorded for transparency but never subtracted a second time —
    // subtracting them would double-count a deduction the sale price
    // already reflects.
    const deductibleComponents = input.costs.resolved.filter((c) => !c.isIncludedInPrice);

    let knownCosts = Money.zero(); // ACTUAL + MARKET_REFERENCE
    let estimatedCosts = Money.zero(); // ESTIMATED
    let userProvidedCosts = Money.zero(); // USER_PROVIDED

    for (const component of deductibleComponents) {
      const amount = Money.fromRupees(component.amount);
      if (component.source === "ESTIMATED") {
        estimatedCosts = estimatedCosts.add(amount);
      } else if (component.source === "USER_PROVIDED") {
        userProvidedCosts = userProvidedCosts.add(amount);
      } else {
        // ACTUAL or MARKET_REFERENCE — both are real, non-fabricated
        // figures, so both count as "known" for the purpose of the total.
        knownCosts = knownCosts.add(amount);
      }
    }

    const totalDeductionsMoney = knownCosts.add(estimatedCosts).add(userProvidedCosts);
    const netRealizationMoney = grossRevenueMoney.subtract(totalDeductionsMoney);

    for (const unavailable of input.costs.unavailable) {
      warnings.push(warningForCategory(unavailable.category));
    }

    const completeness: RealizationCompleteness =
      input.costs.unavailable.length === 0 ? "COMPLETE" : "PARTIAL";
    if (completeness === "PARTIAL") warnings.push("PARTIAL_REALIZATION");

    const applicableComponentCount = deductibleComponents.length + input.costs.unavailable.length;
    const dataCompletenessScore =
      applicableComponentCount === 0 ? 1 : round4(deductibleComponents.length / applicableComponentCount);

    const includedFactors = deductibleComponents.map(
      (c) => `${labelFor(c)} (${c.source})`,
    );

    return {
      grossRevenue: grossRevenueMoney.toNumber(),
      totalKnownCosts: knownCosts.toNumber(),
      totalEstimatedCosts: estimatedCosts.toNumber(),
      totalUserProvidedCosts: userProvidedCosts.toNumber(),
      totalDeductions: totalDeductionsMoney.toNumber(),
      netRealization: netRealizationMoney.toNumber(),
      completeness,
      dataCompletenessScore,
      includedComponents: deductibleComponents,
      omittedComponents: input.costs.unavailable,
      warnings: dedupe(warnings),
      explanation: buildExplanation({
        input,
        includedFactors,
        netRealization: netRealizationMoney.toNumber(),
        completeness,
        warnings,
      }),
    };
  }
}

function labelFor(component: { category: string; name?: string }): string {
  if (component.category === "OTHER" && component.name) return component.name;
  return COST_CATEGORY_LABELS[component.category as keyof typeof COST_CATEGORY_LABELS] ?? component.category;
}

function warningForCategory(category: string): NetRealizationWarning {
  switch (category) {
    case "TRANSPORT":
      return "TRANSPORT_COST_UNAVAILABLE";
    case "LOADING":
      return "LOADING_COST_UNAVAILABLE";
    case "UNLOADING":
      return "UNLOADING_COST_UNAVAILABLE";
    case "PACKAGING":
      return "PACKAGING_COST_UNAVAILABLE";
    case "STORAGE":
      return "STORAGE_COST_UNAVAILABLE";
    case "COMMISSION":
      return "COMMISSION_UNKNOWN";
    case "MARKET_FEE":
      return "MARKET_FEES_UNKNOWN";
    case "TAX":
      return "TAX_UNKNOWN";
    case "INSURANCE":
      return "INSURANCE_UNKNOWN";
    default:
      return "OTHER_COST_UNAVAILABLE";
  }
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Part G — deterministic, template-based explanation. Never AI-generated;
 * every sentence is assembled from the same fixed set of templates given
 * the same inputs, so the explanation is exactly as reproducible as the
 * numbers it describes.
 */
function buildExplanation(args: {
  input: NetRealizationInput;
  includedFactors: string[];
  netRealization: number | null;
  completeness: RealizationCompleteness;
  warnings: NetRealizationWarning[];
}): NetRealizationExplanation {
  const { input, includedFactors, netRealization, completeness, warnings } = args;
  const omittedFactors = input.costs.unavailable.map(
    (c) => `${COST_CATEGORY_LABELS[c.category]} was not included (${c.reason}).`,
  );

  const assumptions: string[] = [];
  if (input.sale.source.type !== "UNAVAILABLE") {
    assumptions.push(priceSourceSentence(input.sale.source.type));
  }

  const warningSentences: string[] = [];
  if (warnings.includes("SALE_PRICE_UNAVAILABLE")) {
    warningSentences.push("No sale price is available, so a net realization could not be calculated.");
  }
  if (warnings.includes("SALE_QUANTITY_UNAVAILABLE")) {
    warningSentences.push("No sale quantity is available, so a net realization could not be calculated.");
  }
  if (completeness === "PARTIAL" && netRealization !== null) {
    warningSentences.push(
      `The net realization shown (\u20b9${netRealization.toFixed(2)}) is partial and may decrease once the omitted costs above are known.`,
    );
  }

  return {
    includedFactors,
    omittedFactors,
    assumptions,
    warnings: warningSentences,
    disclaimer: NET_REALIZATION_DISCLAIMER,
  };
}

function priceSourceSentence(type: string): string {
  switch (type) {
    case "ACCEPTED_OFFER":
      return "Gross revenue was calculated using the accepted buyer offer for this lot.";
    case "OFFER":
      return "Gross revenue was calculated using the specified buyer offer for this lot.";
    case "USER_PROVIDED":
      return "Gross revenue was calculated using the sale price supplied in the request.";
    case "MARKET_REFERENCE":
      return "Gross revenue was calculated using a recent market reference price, not a confirmed sale.";
    default:
      return "Gross revenue could not be calculated because no sale price is available.";
  }
}
