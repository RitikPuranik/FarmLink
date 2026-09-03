import { Prisma, PrismaClient, PriceForecast, PriceForecastStatus } from "@prisma/client";
import { buildScopeKey, scopeFromColumns, scopeToColumns } from "./price-forecasting.scope";
import {
  ForecastConfidence,
  ForecastModelMetadata,
  ForecastOutput,
  ForecastScope,
  PersistedForecast,
} from "./price-forecasting.types";

// Same defensive-cap rationale as SellStoreDecisionRepository's
// MAX_HISTORY_RESULTS (see that file's comment): this module has no
// pagination contract yet, so list methods use a generous fixed bound
// rather than an unbounded query.
const MAX_LIST_RESULTS = 200;

function toPersistedForecast(row: PriceForecast): PersistedForecast {
  const hasOutput = row.status === "COMPLETED";
  return {
    id: row.id,
    publicId: row.publicId,
    cropId: row.cropId,
    scope: scopeFromColumns(row),
    targetDate: row.targetDate,
    horizonDays: row.horizonDays,
    status: row.status,
    output: hasOutput
      ? {
          predictedPrice: Number(row.predictedPrice),
          lowerBound: row.lowerBound === null ? null : Number(row.lowerBound),
          upperBound: row.upperBound === null ? null : Number(row.upperBound),
        }
      : null,
    confidence:
      hasOutput && row.confidenceScore !== null && row.sampleCount !== null
        ? { score: Number(row.confidenceScore), sampleCount: row.sampleCount }
        : null,
    model: {
      modelProvider: row.modelProvider,
      modelVersion: row.modelVersion,
      inputDataStartDate: row.inputDataStartDate as Date,
      inputDataEndDate: row.inputDataEndDate as Date,
      generatedAt: row.generatedAt,
      expiresAt: row.expiresAt,
      metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateOrGetGeneratingForecastInput {
  cropId: string;
  scope: ForecastScope;
  targetDate: Date;
  horizonDays: number;
  modelProvider: string;
  modelVersion: string;
}

export interface CompleteForecastInput {
  output: ForecastOutput;
  confidence: ForecastConfidence;
  model: ForecastModelMetadata;
}

export class PriceForecastRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Idempotent creation: if a forecast already exists for this crop +
   * scope + target date + model version (the unique constraint on
   * scopeKey), that existing row is returned unchanged instead of a
   * duplicate/conflicting one being created — build spec requirement.
   * Callers that want to force regeneration must go through a future
   * part's explicit "supersede" operation, not this method.
   */
  async createOrGetGeneratingForecast(
    input: CreateOrGetGeneratingForecastInput,
  ): Promise<PersistedForecast> {
    const scopeColumns = scopeToColumns(input.scope);
    const scopeKey = buildScopeKey(input.scope);

    const row = await this.prisma.priceForecast.upsert({
      where: {
        cropId_scopeKey_targetDate_modelVersion: {
          cropId: input.cropId,
          scopeKey,
          targetDate: input.targetDate,
          modelVersion: input.modelVersion,
        },
      },
      create: {
        cropId: input.cropId,
        ...scopeColumns,
        scopeKey,
        targetDate: input.targetDate,
        horizonDays: input.horizonDays,
        status: "GENERATING",
        modelProvider: input.modelProvider,
        modelVersion: input.modelVersion,
        // Placeholder until completeForecast() fills in the real value —
        // never read while status is GENERATING (toPersistedForecast only
        // exposes `output` once status is COMPLETED).
        predictedPrice: new Prisma.Decimal(0),
      },
      update: {},
    });

    return toPersistedForecast(row);
  }

  async completeForecast(id: string, input: CompleteForecastInput): Promise<PersistedForecast> {
    const row = await this.prisma.priceForecast.update({
      where: { id },
      data: {
        status: "COMPLETED",
        predictedPrice: new Prisma.Decimal(input.output.predictedPrice),
        lowerBound: input.output.lowerBound === null ? null : new Prisma.Decimal(input.output.lowerBound),
        upperBound: input.output.upperBound === null ? null : new Prisma.Decimal(input.output.upperBound),
        confidenceScore: new Prisma.Decimal(input.confidence.score),
        sampleCount: input.confidence.sampleCount,
        modelProvider: input.model.modelProvider,
        modelVersion: input.model.modelVersion,
        inputDataStartDate: input.model.inputDataStartDate,
        inputDataEndDate: input.model.inputDataEndDate,
        generatedAt: input.model.generatedAt,
        expiresAt: input.model.expiresAt,
        metadata: (input.model.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return toPersistedForecast(row);
  }

  async failForecast(id: string, reasons: string[]): Promise<PersistedForecast> {
    const row = await this.prisma.priceForecast.update({
      where: { id },
      data: {
        status: "FAILED",
        metadata: { failureReasons: reasons } as Prisma.InputJsonValue,
      },
    });
    return toPersistedForecast(row);
  }

  async markInsufficientData(id: string, reasons: string[]): Promise<PersistedForecast> {
    const row = await this.prisma.priceForecast.update({
      where: { id },
      data: {
        status: "INSUFFICIENT_DATA",
        metadata: { insufficiencyReasons: reasons } as Prisma.InputJsonValue,
      },
    });
    return toPersistedForecast(row);
  }

  async findByPublicId(publicId: string): Promise<PersistedForecast | null> {
    const row = await this.prisma.priceForecast.findUnique({ where: { publicId } });
    return row ? toPersistedForecast(row) : null;
  }

  /**
   * The most recent COMPLETED forecast for this crop + scope that has not
   * expired (or was never given an expiry). "Latest" is by generatedAt,
   * not createdAt, since a completed forecast's generatedAt is what a
   * consumer should treat as "as of when this prediction was made".
   */
  async findLatestValid(
    cropId: string,
    scope: ForecastScope,
    asOf: Date = new Date(),
  ): Promise<PersistedForecast | null> {
    const row = await this.prisma.priceForecast.findFirst({
      where: {
        cropId,
        scopeKey: buildScopeKey(scope),
        status: "COMPLETED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: asOf } }],
      },
      orderBy: { generatedAt: "desc" },
    });
    return row ? toPersistedForecast(row) : null;
  }

  async listForCrop(
    cropId: string,
    options: { status?: PriceForecastStatus; limit?: number } = {},
  ): Promise<PersistedForecast[]> {
    const rows = await this.prisma.priceForecast.findMany({
      where: { cropId, ...(options.status ? { status: options.status } : {}) },
      orderBy: { targetDate: "desc" },
      take: Math.min(options.limit ?? MAX_LIST_RESULTS, MAX_LIST_RESULTS),
    });
    return rows.map(toPersistedForecast);
  }

  async listForCropAndMandi(
    cropId: string,
    mandiId: string,
    options: { status?: PriceForecastStatus; limit?: number } = {},
  ): Promise<PersistedForecast[]> {
    const rows = await this.prisma.priceForecast.findMany({
      where: {
        cropId,
        mandiId,
        scopeType: "MANDI",
        ...(options.status ? { status: options.status } : {}),
      },
      orderBy: { targetDate: "desc" },
      take: Math.min(options.limit ?? MAX_LIST_RESULTS, MAX_LIST_RESULTS),
    });
    return rows.map(toPersistedForecast);
  }

  async findByDateRange(
    cropId: string,
    scope: ForecastScope,
    start: Date,
    end: Date,
  ): Promise<PersistedForecast[]> {
    const rows = await this.prisma.priceForecast.findMany({
      where: {
        cropId,
        scopeKey: buildScopeKey(scope),
        targetDate: { gte: start, lte: end },
      },
      orderBy: { targetDate: "asc" },
      take: MAX_LIST_RESULTS,
    });
    return rows.map(toPersistedForecast);
  }
}
