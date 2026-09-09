import { Prisma, PrismaClient, QuantityUnit } from "@prisma/client";
import { MarketDomainError } from "../../common/errors";
import { invalidateMarketCache } from "../market-intelligence/market-cache";

export interface SourceMarketRecord { source: string; sourceRecordId?: string; observedDate: Date; commodity: string; marketId?: string; mandiName: string; state: string; district: string; minPrice: number; maxPrice: number; modalPrice: number; priceUnit: string; arrivals?: number | null; arrivalUnit?: QuantityUnit | null; latitude?: number | null; longitude?: number | null; metadata?: Prisma.InputJsonValue; }
export const normalizeName = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
export function toInrPerQuintal(value: number, unit: string) { const u=normalizeName(unit).replace(/₹|inr|rs\.?/g, "").replace(/[\s/.]/g, ""); if (!Number.isFinite(value) || value < 0) throw new MarketDomainError("Invalid price.", "MARKET_DATA_PROVIDER_ERROR"); if (["quintal","qtl","100kg","perquintal"].includes(u)) return value; if (["kg","perkg"].includes(u)) return value*100; throw new MarketDomainError(`Unsupported price unit: ${unit}.`, "UNSUPPORTED_UNIT"); }

export class MarketDataService {
  private cropCache: {
    byNormalizedName: Map<string, string>;
    byNormalizedAlias: Map<string, string>;
    ambiguousNames: Set<string>;
  } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  async loadCropCache(client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    const crops = await client.crop.findMany({
      select: {
        id: true,
        name: true,
        marketAliases: { select: { source: true, normalizedAlias: true } },
      },
    });

    const byNormalizedName = new Map<string, string>();
    const byNormalizedAlias = new Map<string, string>();
    const ambiguousNames = new Set<string>();

    for (const crop of crops) {
      const norm = normalizeName(crop.name);
      if (byNormalizedName.has(norm)) {
        ambiguousNames.add(norm);
      } else {
        byNormalizedName.set(norm, crop.id);
      }

      for (const alias of crop.marketAliases) {
        const key = `${alias.source}:${alias.normalizedAlias}`;
        if (byNormalizedAlias.has(key)) {
          ambiguousNames.add(key);
        } else {
          byNormalizedAlias.set(key, crop.id);
        }
      }
    }

    this.cropCache = { byNormalizedName, byNormalizedAlias, ambiguousNames };
  }

  async resolveCrop(source: string, commodity: string, client?: PrismaClient | Prisma.TransactionClient) {
    const normalized = normalizeName(commodity);
    const aliasKey = `${source}:${normalized}`;

    if (this.cropCache) {
      if (this.cropCache.ambiguousNames.has(normalized) || this.cropCache.ambiguousNames.has(aliasKey)) {
        return "AMBIGUOUS" as const;
      }
      const byNameId = this.cropCache.byNormalizedName.get(normalized);
      const byAliasId = this.cropCache.byNormalizedAlias.get(aliasKey);

      if (byNameId && byAliasId && byNameId !== byAliasId) return "AMBIGUOUS" as const;
      const id = byNameId ?? byAliasId;
      if (id) return { id };
    }

    const c = client ?? this.prisma;
    const [byName, byAlias] = await Promise.all([
      c.crop.findFirst({ where: { name: { equals: commodity, mode: "insensitive" } }, select: { id: true } }),
      c.crop.findFirst({ where: { marketAliases: { some: { source, normalizedAlias: normalized } } }, select: { id: true } }),
    ]);
    if (byName && byAlias && byName.id !== byAlias.id) return "AMBIGUOUS" as const;
    const existing = byName ?? byAlias;
    if (existing) {
      if (this.cropCache) {
        this.cropCache.byNormalizedName.set(normalized, existing.id);
        this.cropCache.byNormalizedAlias.set(aliasKey, existing.id);
      }
      return existing;
    }

    // Dynamic API-driven provisioning: auto-create the crop and alias so nothing is hardcoded
    const cleanName = commodity.trim().replace(/\s+/g, " ");
    if (!cleanName) return null;

    let newCrop = await c.crop.findFirst({
      where: { name: { equals: cleanName, mode: "insensitive" } },
      select: { id: true },
    });
    if (!newCrop) {
      newCrop = await c.crop.create({
        data: { name: cleanName, active: true },
        select: { id: true },
      });
    }

    try {
      await c.cropAlias.upsert({
        where: { source_normalizedAlias: { source, normalizedAlias: normalized } },
        create: { cropId: newCrop.id, source, alias: cleanName, normalizedAlias: normalized },
        update: {},
      });
    } catch {
      // Alias may already exist
    }

    if (this.cropCache) {
      this.cropCache.byNormalizedName.set(normalized, newCrop.id);
      this.cropCache.byNormalizedAlias.set(aliasKey, newCrop.id);
    }

    return newCrop;
  }

  async persist(record: SourceMarketRecord, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    if (!(record.observedDate instanceof Date) || Number.isNaN(record.observedDate.getTime())) throw new MarketDomainError("Invalid observed date.", "INVALID_DATE");
    if (!record.commodity.trim()) throw new MarketDomainError("Crop name is required.", "UNKNOWN_CROP");
    if (!record.mandiName.trim() || !record.state.trim() || !record.district.trim()) throw new MarketDomainError("Mandi name, state and district are required.", "MARKET_DATA_PROVIDER_ERROR");
    if (![record.minPrice, record.maxPrice, record.modalPrice].every((value) => Number.isFinite(value) && value >= 0)) throw new MarketDomainError("Invalid price value.", "MARKET_DATA_PROVIDER_ERROR");
    if (record.minPrice > record.modalPrice || record.modalPrice > record.maxPrice) throw new MarketDomainError("Minimum, modal and maximum prices are inconsistent.", "MARKET_DATA_PROVIDER_ERROR");
    if (record.arrivals !== undefined && record.arrivals !== null && (!Number.isFinite(record.arrivals) || record.arrivals < 0)) throw new MarketDomainError("Invalid arrivals value.", "MARKET_DATA_PROVIDER_ERROR");
    const hasLatitude = record.latitude !== undefined && record.latitude !== null;
    const hasLongitude = record.longitude !== undefined && record.longitude !== null;
    if (hasLatitude !== hasLongitude || (hasLatitude && (Math.abs(record.latitude as number) > 90 || Math.abs(record.longitude as number) > 180))) throw new MarketDomainError("Invalid market coordinates.", "INVALID_LOCATION");

    const crop = await this.resolveCrop(record.source, record.commodity, client);
    if (crop === "AMBIGUOUS") return { imported: false, reason: "AMBIGUOUS_CROP" as const };
    if (!crop) return { imported: false, reason: "UNKNOWN_CROP" as const };

    const normalizedName = normalizeName(record.mandiName);
    const mandi = record.marketId
      ? await client.mandi.upsert({
          where: { source_sourceMarketId: { source: record.source, sourceMarketId: record.marketId } },
          create: { source: record.source, sourceMarketId: record.marketId, name: record.mandiName, normalizedName, state: record.state, district: record.district, latitude: record.latitude ?? null, longitude: record.longitude ?? null },
          update: { name: record.mandiName, state: record.state, district: record.district, latitude: record.latitude ?? undefined, longitude: record.longitude ?? undefined },
        })
      : await client.mandi.upsert({
          where: { source_normalizedName_district_state: { source: record.source, normalizedName, district: record.district, state: record.state } },
          create: { source: record.source, name: record.mandiName, normalizedName, state: record.state, district: record.district, latitude: record.latitude ?? null, longitude: record.longitude ?? null },
          update: { name: record.mandiName },
        });

    const [minPrice, maxPrice, modalPrice] = [record.minPrice, record.maxPrice, record.modalPrice].map((v) => toInrPerQuintal(v, record.priceUnit));
    const create = { cropId: crop.id, mandiId: mandi.id, source: record.source, sourceRecordId: record.sourceRecordId ?? null, observedDate: record.observedDate, minPrice, maxPrice, modalPrice, arrivalQuantity: record.arrivals ?? null, arrivalUnit: record.arrivalUnit ?? null, sourceMetadata: record.metadata };
    const update = { minPrice, maxPrice, modalPrice, arrivalQuantity: record.arrivals ?? null, arrivalUnit: record.arrivalUnit ?? null, sourceMetadata: record.metadata, retrievedAt: new Date() };

    if (record.sourceRecordId) {
      await client.mandiPrice.upsert({ where: { source_sourceRecordId: { source: record.source, sourceRecordId: record.sourceRecordId } }, create, update });
    } else {
      await client.mandiPrice.upsert({ where: { cropId_mandiId_observedDate_source: { cropId: crop.id, mandiId: mandi.id, observedDate: record.observedDate, source: record.source } }, create, update });
    }
    return { imported: true as const };
  }

  async run(records: AsyncIterable<SourceMarketRecord>, source: string, operation: "HISTORICAL_IMPORT" | "INCREMENTAL_SYNC") {
    const run = await this.prisma.marketDataImportRun.create({ data: { source, operation } });
    let read = 0, imported = 0, rejected = 0;
    let newestObservedDate: Date | undefined;
    const diagnostics: string[] = [];

    await this.loadCropCache();

    const processChunk = async (chunk: SourceMarketRecord[]) =>
      this.prisma.$transaction(async (tx) => {
        for (const record of chunk) {
          try {
            const outcome = await this.persist(record, tx);
            if (outcome.imported) {
              imported++;
              if (!newestObservedDate || record.observedDate > newestObservedDate) {
                newestObservedDate = record.observedDate;
              }
            } else {
              rejected++;
              diagnostics.push(`${record.commodity}: ${outcome.reason}`);
            }
          } catch (err) {
            rejected++;
            diagnostics.push(`${record?.commodity ?? "record"}: ${err instanceof Error ? err.message : "Invalid record"}`);
          }
        }
      }, { timeout: 60_000 });

    try {
      let chunk: SourceMarketRecord[] = [];
      let lastReportedRead = 0;
      for await (const record of records) {
        read++;
        chunk.push(record);
        if (chunk.length === 25) {
          await processChunk(chunk);
          chunk = [];
        }
        if (read - lastReportedRead >= 100) {
          console.log(`[Market Data] Processed ${read} records (${imported} imported, ${rejected} rejected)...`);
          lastReportedRead = read;
        }
      }
      if (chunk.length) {
        await processChunk(chunk);
      }
      console.log(`[Market Data] Seed finished: ${read} total records read (${imported} imported, ${rejected} rejected).`);

      const status = rejected ? (imported ? "PARTIAL_SUCCESS" : "FAILED") : "SUCCEEDED";
      await this.prisma.marketDataImportRun.update({
        where: { id: run.id },
        data: {
          status,
          recordsRead: read,
          recordsImported: imported,
          recordsSkipped: rejected,
          recordsRejected: rejected,
          validationFailures: rejected,
          diagnostics: diagnostics.slice(0, 100),
          completedAt: new Date(),
        },
      });

      if (imported) await invalidateMarketCache();
      return { runId: run.id, read, imported, rejected, newestObservedDate };
    } catch (err) {
      await this.prisma.marketDataImportRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          recordsRead: read,
          recordsImported: imported,
          recordsRejected: rejected,
          validationFailures: rejected,
          diagnostics: diagnostics.slice(0, 100),
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }
}
