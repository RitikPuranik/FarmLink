import { PrismaClient } from "@prisma/client";
import { PricePoint } from "./market-intelligence.types";

const point = (p: { observedDate: Date; modalPrice: unknown; minPrice: unknown; maxPrice: unknown; arrivalQuantity: unknown }) : PricePoint => ({ date: p.observedDate, modalPrice: Number(p.modalPrice), minPrice: Number(p.minPrice), maxPrice: Number(p.maxPrice), arrivalQuantity: p.arrivalQuantity === null ? null : Number(p.arrivalQuantity) });

export class MarketIntelligenceRepository {
  constructor(private readonly prisma: PrismaClient) {}
  crop(id: string) { return this.prisma.crop.findUnique({ where: { id }, select: { id: true, name: true } }); }
  mandi(publicId: string) { return this.prisma.mandi.findUnique({ where: { publicId }, select: { id: true, publicId: true, name: true, district: true, state: true, latitude: true, longitude: true } }); }
  async history(cropId: string, start: Date, end: Date, mandiId?: string) { const rows = await this.prisma.mandiPrice.findMany({ where: { cropId, ...(mandiId ? { mandiId } : {}), observedDate: { gte: start, lte: end } }, orderBy: { observedDate: "asc" }, select: { observedDate: true, modalPrice: true, minPrice: true, maxPrice: true, arrivalQuantity: true } }); return rows.map(point); }
  /**
   * Batched equivalent of calling history() once per mandi. Nearby-market
   * search evaluates every candidate mandi's recent trend/volatility, so a
   * per-mandi query there would be an N+1 (one round trip per candidate);
   * this fetches all of them in a single indexed query and groups in memory.
   */
  async historyForMandis(cropId: string, start: Date, end: Date, mandiIds: string[]) {
    const byMandi = new Map<string, PricePoint[]>();
    if (!mandiIds.length) return byMandi;
    const rows = await this.prisma.mandiPrice.findMany({ where: { cropId, mandiId: { in: mandiIds }, observedDate: { gte: start, lte: end } }, orderBy: { observedDate: "asc" }, select: { mandiId: true, observedDate: true, modalPrice: true, minPrice: true, maxPrice: true, arrivalQuantity: true } });
    for (const row of rows) { const list = byMandi.get(row.mandiId); const p = point(row); if (list) list.push(p); else byMandi.set(row.mandiId, [p]); }
    return byMandi;
  }
  async latestMarkets(cropId: string, filters: { state?: string; district?: string; lat?: number; lon?: number; radiusKm?: number }) {
    const latest = await this.prisma.mandiPrice.groupBy({ by: ["mandiId"], where: { cropId }, _max: { observedDate: true } });
    if (!latest.length) return [];
    const pairs = await this.prisma.mandiPrice.findMany({ where: { cropId, OR: latest.map(x => ({ mandiId: x.mandiId, observedDate: x._max.observedDate! })) }, select: { mandiId: true, observedDate: true, modalPrice: true, minPrice: true, maxPrice: true, arrivalQuantity: true, mandi: { select: { id: true, publicId: true, name: true, district: true, state: true, latitude: true, longitude: true } } } });
    return pairs.filter(p => (!filters.state || p.mandi.state === filters.state) && (!filters.district || p.mandi.district === filters.district)).map(p => ({ mandi: p.mandi, latest: point(p) }));
  }
  async overview(mandiId: string) { return this.prisma.mandiPrice.groupBy({ by: ["cropId"], where: { mandiId }, _count: { cropId: true }, _max: { observedDate: true } }); }
}
