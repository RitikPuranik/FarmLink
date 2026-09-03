import { PrismaClient } from "@prisma/client";
import { ForecastScope } from "./price-forecasting.types";
import { HistoryWindow, RawPriceRow } from "./price-history.types";

// MandiPrice remains the sole authoritative source of historical prices —
// this repository only ever reads it (bounded, indexed queries) and never
// writes, copies, or snapshots rows into any other table. It deliberately
// does no sorting, deduplication, or aggregation of its own: those are
// pure functions in price-history.aggregation.ts, per the build spec's
// "database repository should only retrieve raw historical data."
function toRawPriceRow(row: { mandiId: string; observedDate: Date; modalPrice: unknown }): RawPriceRow {
  return {
    mandiId: row.mandiId,
    observedDate: row.observedDate,
    modalPrice: row.modalPrice === null || row.modalPrice === undefined ? null : Number(row.modalPrice),
  };
}

const RAW_ROW_SELECT = { mandiId: true, observedDate: true, modalPrice: true } as const;

export class PriceHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** MANDI scope: crop + a single mandi. Bounded by `window`, indexed by
   *  the existing `[mandiId, observedDate]` / `[cropId, mandiId,
   *  observedDate]` MandiPrice indexes — one query, no per-date looping. */
  async mandiHistory(cropId: string, mandiId: string, window: HistoryWindow): Promise<RawPriceRow[]> {
    const rows = await this.prisma.mandiPrice.findMany({
      where: { cropId, mandiId, observedDate: { gte: window.start, lte: window.end } },
      select: RAW_ROW_SELECT,
    });
    return rows.map(toRawPriceRow);
  }

  /** REGIONAL scope: crop + state (+ optional district), across whichever
   *  mandis in that state/district actually reported a price — never a
   *  synthesized crop-mandi combination for markets with no records. A
   *  single joined query against every matching mandi, not one query per
   *  mandi (see MarketIntelligenceRepository.historyForMandis for the same
   *  batched-not-N+1 rationale). */
  async regionalHistory(
    cropId: string,
    state: string,
    district: string | undefined,
    window: HistoryWindow,
  ): Promise<RawPriceRow[]> {
    const rows = await this.prisma.mandiPrice.findMany({
      where: {
        cropId,
        observedDate: { gte: window.start, lte: window.end },
        mandi: { state, ...(district ? { district } : {}) },
      },
      select: RAW_ROW_SELECT,
    });
    return rows.map(toRawPriceRow);
  }

  /** CROP_WIDE scope: crop across every mandi that reported a price in the
   *  window — same single bounded-query shape as regionalHistory, just
   *  without the state/district filter. */
  async cropWideHistory(cropId: string, window: HistoryWindow): Promise<RawPriceRow[]> {
    const rows = await this.prisma.mandiPrice.findMany({
      where: { cropId, observedDate: { gte: window.start, lte: window.end } },
      select: RAW_ROW_SELECT,
    });
    return rows.map(toRawPriceRow);
  }

  /**
   * Total historical observation count for a scope, with no date bound —
   * what checkDataSufficiency()'s `totalObservations` needs. This is a
   * COUNT query (no row data transferred), so it satisfies that contract
   * without violating the "do not load all historical prices forever"
   * performance requirement: the database counts, this process never sees
   * more than a single integer.
   */
  async countTotalObservations(cropId: string, scope: ForecastScope): Promise<number> {
    switch (scope.type) {
      case "MANDI":
        return this.prisma.mandiPrice.count({ where: { cropId, mandiId: scope.mandiId } });
      case "REGIONAL":
        return this.prisma.mandiPrice.count({
          where: { cropId, mandi: { state: scope.state, ...(scope.district ? { district: scope.district } : {}) } },
        });
      case "CROP_WIDE":
        return this.prisma.mandiPrice.count({ where: { cropId } });
    }
  }
}
