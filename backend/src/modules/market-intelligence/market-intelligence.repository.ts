import { PrismaClient } from "@prisma/client";
import { PricePoint } from "./market-intelligence.types";

const point = (p: { observedDate: Date; modalPrice: unknown; minPrice: unknown; maxPrice: unknown; arrivalQuantity: unknown }) : PricePoint => ({ date: p.observedDate, modalPrice: Number(p.modalPrice), minPrice: Number(p.minPrice), maxPrice: Number(p.maxPrice), arrivalQuantity: p.arrivalQuantity === null ? null : Number(p.arrivalQuantity) });

export class MarketIntelligenceRepository {
  constructor(private readonly prisma: PrismaClient) {}
  crop(id: string) { return this.prisma.crop.findUnique({ where: { id }, select: { id: true, name: true } }); }
  mandi(id: string) { return this.prisma.mandi.findUnique({ where: { id }, select: { id: true, name: true, district: true, state: true, latitude: true, longitude: true } }); }
  async history(cropId: string, start: Date, end: Date, mandiId?: string) { const rows = await this.prisma.mandiPrice.findMany({ where: { cropId, ...(mandiId ? { mandiId } : {}), observedDate: { gte: start, lte: end } }, orderBy: { observedDate: "asc" }, select: { observedDate: true, modalPrice: true, minPrice: true, maxPrice: true, arrivalQuantity: true } }); return rows.map(point); }
  async latestMarkets(cropId: string, filters: { state?: string; district?: string; lat?: number; lon?: number; radiusKm?: number }) {
    const latest = await this.prisma.mandiPrice.groupBy({ by: ["mandiId"], where: { cropId }, _max: { observedDate: true } });
    if (!latest.length) return [];
    const pairs = await this.prisma.mandiPrice.findMany({ where: { cropId, OR: latest.map(x => ({ mandiId: x.mandiId, observedDate: x._max.observedDate! })) }, select: { mandiId: true, observedDate: true, modalPrice: true, minPrice: true, maxPrice: true, arrivalQuantity: true, mandi: { select: { id: true, name: true, district: true, state: true, latitude: true, longitude: true } } } });
    return pairs.filter(p => (!filters.state || p.mandi.state === filters.state) && (!filters.district || p.mandi.district === filters.district)).map(p => ({ mandi: p.mandi, latest: point(p) }));
  }
  async overview(mandiId: string) { return this.prisma.mandiPrice.groupBy({ by: ["cropId"], where: { mandiId }, _count: { cropId: true }, _max: { observedDate: true } }); }
}
