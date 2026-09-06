import { PrismaClient, TradeOffer } from "@prisma/client";
import { NetRealizationDomainError, NotFoundError } from "../../common/errors";
import { CropLotRepository } from "../lots/lots.repository";
import { MarketIntelligenceRepository } from "../market-intelligence/market-intelligence.repository";
import { convertKgToQuantity, convertQuantityToKg } from "../fpo/unit-conversion";
import { StorageIntelligenceProvider } from "../warehouse-intelligence/storage-intelligence-provider";
import {
  NetRealizationRequestOverrides,
  ResolvedNetRealizationInput,
} from "./net-realization-input-resolver.types";
import {
  CostComponent,
  NetRealizationInput,
  NetRealizationPriceSource,
  UnavailableCostComponent,
} from "./net-realization.types";
import { NAMED_COST_CATEGORIES } from "./net-realization.config";

/**
 * Part C/D — Input Resolution.
 *
 * Resolves the lot, the applicable sale price (Part C's deterministic
 * priority order, adapted to what actually exists in this schema — see
 * `resolvePriceSource` below), and every cost category's availability
 * (Part D). Never invents a value: a category with nothing behind it is
 * always returned in `unavailable`, never silently defaulted to zero or
 * an estimate this module has no basis for.
 */
export class NetRealizationInputResolverService {
  constructor(
    private readonly lots: CropLotRepository,
    private readonly prisma: PrismaClient,
    private readonly market: MarketIntelligenceRepository,
    private readonly storageIntelligence: StorageIntelligenceProvider,
  ) {}

  async resolve(
    lotPublicId: string,
    overrides: NetRealizationRequestOverrides,
    requestingUser: { id: string; role: string },
  ): Promise<ResolvedNetRealizationInput> {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const priceResolution = await this.resolvePriceSource(lot.id, lot.cropId, Number(lot.availableQuantityKg), overrides);
    const { unit, pricePerUnit, quantity, source, quantityKg } = priceResolution;

    const { resolved: resolvedCosts, unavailable: unavailableCosts } = await this.resolveCosts(
      lot.cropId,
      quantityKg,
      overrides,
      requestingUser,
    );

    const input: NetRealizationInput = {
      lot: {
        lotId: lot.id,
        lotPublicId: lot.publicId,
        cropId: lot.cropId,
        cropName: lot.crop.name,
        availableQuantityKg: Number(lot.availableQuantityKg),
      },
      sale: {
        pricePerUnit,
        priceUnit: unit,
        quantity,
        quantityUnit: unit,
        source,
      },
      costs: {
        resolved: resolvedCosts,
        unavailable: unavailableCosts,
      },
    };

    return { lotId: lot.id, cropId: lot.cropId, input };
  }

  /**
   * Deterministic price priority (Part C), adapted to the real schema —
   * there is no separate RFQ model, only Module 7's TradeOffer:
   *   1. An explicitly requested `offerPublicId` (must belong to this lot).
   *   2. The lot's own ACCEPTED TradeOffer, if one exists — auto-detected,
   *      since an accepted offer is the closest thing this system has to
   *      a confirmed sale.
   *   3. An explicit `salePricePerUnit` supplied on the request
   *      (USER_PROVIDED, a what-if calculation).
   *   4. A recent MandiPrice market reference for this crop near the
   *      lot's origin (MARKET_REFERENCE — explicitly NOT a confirmed
   *      sale price, and labeled as such throughout the response).
   *   5. Otherwise: SALE_PRICE_UNAVAILABLE (`type: "UNAVAILABLE"`) — never
   *      fabricated.
   */
  private async resolvePriceSource(
    lotId: string,
    cropId: string,
    lotAvailableQuantityKg: number,
    overrides: NetRealizationRequestOverrides,
  ): Promise<{
    pricePerUnit: number | null;
    quantity: number | null;
    quantityKg: number;
    unit: NetRealizationInput["sale"]["priceUnit"];
    source: NetRealizationPriceSource;
  }> {
    if (overrides.offerPublicId) {
      const offer = await this.prisma.tradeOffer.findUnique({ where: { publicId: overrides.offerPublicId } });
      if (!offer || offer.lotId !== lotId) {
        throw new NetRealizationDomainError("The specified offer does not belong to this lot.", "OFFER_NOT_FOUND_FOR_LOT", 404);
      }
      return this.fromOffer(offer, overrides);
    }

    const acceptedOffer = await this.prisma.tradeOffer.findFirst({
      where: { lotId, status: "ACCEPTED" },
      orderBy: { updatedAt: "desc" },
    });
    if (acceptedOffer) {
      return this.fromOffer(acceptedOffer, overrides);
    }

    if (overrides.salePricePerUnit !== undefined) {
      if (overrides.salePricePerUnit < 0) {
        throw new NetRealizationDomainError("Sale price cannot be negative.", "INVALID_SALE_PRICE");
      }
      const unit = overrides.salePriceUnit ?? "KG";
      const quantityKg = this.resolveOverrideQuantityKg(overrides, unit, lotAvailableQuantityKg);
      return {
        pricePerUnit: overrides.salePricePerUnit,
        quantity: convertKgToQuantity(quantityKg, unit),
        quantityKg,
        unit,
        source: { type: "USER_PROVIDED", referenceId: null, valueSource: "USER_PROVIDED" },
      };
    }

    const marketPrice = await this.resolveMarketReferencePrice(cropId, lotId);
    if (marketPrice) {
      const quantityKg = this.resolveOverrideQuantityKg(overrides, "QTL", lotAvailableQuantityKg);
      return {
        pricePerUnit: marketPrice,
        quantity: convertKgToQuantity(quantityKg, "QTL"),
        quantityKg,
        unit: "QTL",
        source: { type: "MARKET_REFERENCE", referenceId: null, valueSource: "MARKET_REFERENCE" },
      };
    }

    return {
      pricePerUnit: null,
      quantity: null,
      quantityKg: 0,
      unit: null,
      source: { type: "UNAVAILABLE", referenceId: null, valueSource: "UNKNOWN" },
    };
  }

  private fromOffer(offer: TradeOffer, overrides: NetRealizationRequestOverrides) {
    const unit = offer.quantityUnit;
    const offerQuantityKg = convertQuantityToKg(Number(offer.quantity), unit);
    const quantityKg = this.resolveOverrideQuantityKg(overrides, unit, offerQuantityKg);
    return {
      pricePerUnit: Number(offer.offeredPrice),
      quantity: convertKgToQuantity(quantityKg, unit),
      quantityKg,
      unit,
      source: {
        type: (offer.status === "ACCEPTED" ? "ACCEPTED_OFFER" : "OFFER") as NetRealizationPriceSource["type"],
        referenceId: offer.publicId,
        valueSource: "ACTUAL" as const,
      },
    };
  }

  /** Resolves the sale quantity in KG: an explicit request override wins,
   * otherwise falls back to `sourceQuantityKg` — an offer's own committed
   * quantity when the price came from an offer, or the lot's full
   * available quantity otherwise (always a real number by the time this
   * is called; never a fabricated one). */
  private resolveOverrideQuantityKg(
    overrides: NetRealizationRequestOverrides,
    fallbackUnit: NetRealizationInput["sale"]["priceUnit"],
    sourceQuantityKg: number | null,
  ): number {
    if (overrides.saleQuantity !== undefined) {
      if (overrides.saleQuantity <= 0) {
        throw new NetRealizationDomainError("Sale quantity must be a positive number.", "INVALID_QUANTITY");
      }
      const unit = overrides.saleQuantityUnit ?? fallbackUnit ?? "KG";
      return convertQuantityToKg(overrides.saleQuantity, unit);
    }
    return sourceQuantityKg ?? 0;
  }

  /**
   * Fallback cascade mirrors sell-store-input-resolver.service.ts's own
   * district -> state -> national widening, reusing the same
   * MarketIntelligenceRepository Module 6 already exposes rather than
   * re-querying MandiPrice directly.
   */
  private async resolveMarketReferencePrice(cropId: string, lotId: string): Promise<number | null> {
    const lot = await this.lots.findById(lotId);
    if (!lot) return null;

    let markets = await this.market.latestMarkets(cropId, { state: lot.originState, district: lot.originDistrict });
    if (!markets.length) markets = await this.market.latestMarkets(cropId, { state: lot.originState });
    if (!markets.length) markets = await this.market.latestMarkets(cropId, {});
    if (!markets.length) return null;

    const total = markets.reduce((sum: number, m: { latest: { modalPrice: number } }) => sum + m.latest.modalPrice, 0);
    return round2(total / markets.length);
  }

  /**
   * Part D — Cost Resolution. Every named category is evaluated; anything
   * with no real backing data becomes an `unavailable` entry, never a
   * silently-assumed zero.
   *
   *   - A caller-supplied `costs[]` override always wins for its category
   *     (USER_PROVIDED) — the one explicit exception to "the system never
   *     trusts client-supplied actuals": Part K requires these to be
   *     clearly labeled, which is exactly what happens here.
   *   - STORAGE is the one category with a real, already-implemented
   *     non-fabricated estimator: Module 9 Part 6's
   *     StorageIntelligenceProvider (see this module's own doc for why
   *     this is the only automatically-resolved category today).
   *   - Every other named category (TRANSPORT/LOADING/UNLOADING/
   *     PACKAGING/COMMISSION/MARKET_FEE/TAX/INSURANCE) has no backing
   *     model anywhere in this schema yet, so it is only ever resolved
   *     from a user-provided override — never a fabricated per-km rate or
   *     guessed percentage (Part D's own explicit prohibition).
   *   - OTHER is a variable-length, caller-only category (Part C).
   */
  private async resolveCosts(
    cropId: string,
    quantityKg: number,
    overrides: NetRealizationRequestOverrides,
    requestingUser: { id: string; role: string },
  ): Promise<{ resolved: CostComponent[]; unavailable: UnavailableCostComponent[] }> {
    for (const cost of overrides.costs ?? []) {
      if (cost.amount < 0) {
        throw new NetRealizationDomainError(`${cost.category} cost cannot be negative.`, "INVALID_COST_AMOUNT");
      }
    }

    const userProvidedByCategory = new Map(
      (overrides.costs ?? []).filter((c) => c.category !== "OTHER").map((c) => [c.category, c]),
    );
    const otherComponents = (overrides.costs ?? []).filter((c) => c.category === "OTHER");

    const resolved: CostComponent[] = [];
    const unavailable: UnavailableCostComponent[] = [];

    for (const category of NAMED_COST_CATEGORIES) {
      const userProvided = userProvidedByCategory.get(category);
      if (userProvided) {
        resolved.push({
          category,
          amount: userProvided.amount,
          source: "USER_PROVIDED",
          isIncludedInPrice: userProvided.isIncludedInPrice,
        });
        continue;
      }

      if (category === "STORAGE" && quantityKg > 0) {
        const context = await this.storageIntelligence.resolveStorageContext({
          cropId,
          quantity: quantityKg,
          unit: "KG",
          requestingUser,
        });
        if (context.estimatedCost !== null) {
          resolved.push({ category: "STORAGE", amount: context.estimatedCost, source: "ESTIMATED" });
          continue;
        }
      }

      unavailable.push({ category, reason: `${category}_COST_UNAVAILABLE` });
    }

    for (const other of otherComponents) {
      resolved.push({
        category: "OTHER",
        name: other.name ?? "Other",
        amount: other.amount,
        source: "USER_PROVIDED",
        isIncludedInPrice: other.isIncludedInPrice,
      });
    }

    return { resolved, unavailable };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
