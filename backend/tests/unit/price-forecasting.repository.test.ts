// The generated Prisma client isn't available in this sandbox (see
// prisma/README-engines.md) — Prisma.Decimal in particular has no runtime
// implementation until `prisma generate` has run against a real database.
// This lightweight stand-in lets PriceForecastRepository's real Decimal
// conversion code run under test (the same pattern the rest of the suite
// relies on the mocked PrismaClient methods for) without depending on the
// live-generated engine.
jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client");
  class FakeDecimal {
    private readonly value: number;
    constructor(v: number | string) {
      this.value = Number(v);
    }
    toString() {
      return String(this.value);
    }
    valueOf() {
      return this.value;
    }
  }
  return { ...actual, Prisma: { ...actual.Prisma, Decimal: FakeDecimal } };
});

import { PrismaClient } from "@prisma/client";
import { PriceForecastRepository } from "../../src/modules/price-forecasting/price-forecasting.repository";
import { ForecastConfidence, ForecastModelMetadata, ForecastOutput } from "../../src/modules/price-forecasting/price-forecasting.types";

describe("PriceForecastRepository (Module 7 Part 1)", () => {
  let prismaMock: any;
  let repository: PriceForecastRepository;

  beforeEach(() => {
    prismaMock = {
      priceForecast: {
        upsert: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repository = new PriceForecastRepository(prismaMock as unknown as PrismaClient);
  });

  const baseRow = {
    id: "forecast-1",
    publicId: "public-1",
    cropId: "crop-1",
    scopeType: "MANDI" as const,
    mandiId: "mandi-1",
    regionState: null,
    regionDistrict: null,
    scopeKey: "MANDI:mandi-1",
    targetDate: new Date("2026-09-10"),
    horizonDays: 7,
    predictedPrice: 2500,
    lowerBound: 2300,
    upperBound: 2700,
    confidenceScore: 0.8,
    status: "COMPLETED" as const,
    modelProvider: "test-provider",
    modelVersion: "v1",
    inputDataStartDate: new Date("2026-08-01"),
    inputDataEndDate: new Date("2026-09-01"),
    sampleCount: 45,
    generatedAt: new Date("2026-09-03"),
    expiresAt: new Date("2026-09-04"),
    metadata: null,
    createdAt: new Date("2026-09-03"),
    updatedAt: new Date("2026-09-03"),
  };

  it("createOrGetGeneratingForecast upserts on the (crop, scope, target date, model version) key — idempotency", async () => {
    prismaMock.priceForecast.upsert.mockResolvedValue({ ...baseRow, status: "GENERATING", predictedPrice: 0 });

    await repository.createOrGetGeneratingForecast({
      cropId: "crop-1",
      scope: { type: "MANDI", mandiId: "mandi-1" },
      targetDate: baseRow.targetDate,
      horizonDays: 7,
      modelProvider: "test-provider",
      modelVersion: "v1",
    });

    expect(prismaMock.priceForecast.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          cropId_scopeKey_targetDate_modelVersion: {
            cropId: "crop-1",
            scopeKey: "MANDI:mandi-1",
            targetDate: baseRow.targetDate,
            modelVersion: "v1",
          },
        },
        // A second call for the same key must not create a conflicting
        // record — the update branch is intentionally a no-op.
        update: {},
      }),
    );
  });

  it("completeForecast persists Decimal price values and confidence bounds", async () => {
    prismaMock.priceForecast.update.mockResolvedValue(baseRow);

    const output: ForecastOutput = { predictedPrice: 2500, lowerBound: 2300, upperBound: 2700 };
    const confidence: ForecastConfidence = { score: 0.8, sampleCount: 45 };
    const model: ForecastModelMetadata = {
      modelProvider: "test-provider",
      modelVersion: "v1",
      inputDataStartDate: baseRow.inputDataStartDate,
      inputDataEndDate: baseRow.inputDataEndDate,
      generatedAt: baseRow.generatedAt,
      expiresAt: baseRow.expiresAt,
    };

    const result = await repository.completeForecast("forecast-1", { output, confidence, model });

    const callArgs = prismaMock.priceForecast.update.mock.calls[0][0];
    expect(callArgs.where).toEqual({ id: "forecast-1" });
    expect(callArgs.data.status).toBe("COMPLETED");
    expect(Number(callArgs.data.predictedPrice)).toBe(2500);
    expect(Number(callArgs.data.lowerBound)).toBe(2300);
    expect(Number(callArgs.data.upperBound)).toBe(2700);
    expect(Number(callArgs.data.confidenceScore)).toBe(0.8);
    expect(callArgs.data.sampleCount).toBe(45);

    expect(result.output).toEqual({ predictedPrice: 2500, lowerBound: 2300, upperBound: 2700 });
    expect(result.confidence).toEqual({ score: 0.8, sampleCount: 45 });
  });

  it("completeForecast allows a null lower/upper bound without breaking Decimal conversion", async () => {
    prismaMock.priceForecast.update.mockResolvedValue({ ...baseRow, lowerBound: null, upperBound: null });

    await repository.completeForecast("forecast-1", {
      output: { predictedPrice: 2500, lowerBound: null, upperBound: null },
      confidence: { score: 0.5, sampleCount: 10 },
      model: {
        modelProvider: "test-provider",
        modelVersion: "v1",
        inputDataStartDate: baseRow.inputDataStartDate,
        inputDataEndDate: baseRow.inputDataEndDate,
        generatedAt: baseRow.generatedAt,
        expiresAt: null,
      },
    });

    const callArgs = prismaMock.priceForecast.update.mock.calls[0][0];
    expect(callArgs.data.lowerBound).toBeNull();
    expect(callArgs.data.upperBound).toBeNull();
  });

  it("failDecision-equivalent: failForecast records reasons and sets FAILED status", async () => {
    prismaMock.priceForecast.update.mockResolvedValue({ ...baseRow, status: "FAILED", metadata: { failureReasons: ["PROVIDER_ERROR"] } });

    await repository.failForecast("forecast-1", ["PROVIDER_ERROR"]);

    expect(prismaMock.priceForecast.update).toHaveBeenCalledWith({
      where: { id: "forecast-1" },
      data: { status: "FAILED", metadata: { failureReasons: ["PROVIDER_ERROR"] } },
    });
  });

  it("markInsufficientData records structured insufficiency reasons", async () => {
    prismaMock.priceForecast.update.mockResolvedValue({
      ...baseRow,
      status: "INSUFFICIENT_DATA",
      metadata: { insufficiencyReasons: ["NO_HISTORICAL_DATA"] },
    });

    await repository.markInsufficientData("forecast-1", ["NO_HISTORICAL_DATA"]);

    expect(prismaMock.priceForecast.update).toHaveBeenCalledWith({
      where: { id: "forecast-1" },
      data: { status: "INSUFFICIENT_DATA", metadata: { insufficiencyReasons: ["NO_HISTORICAL_DATA"] } },
    });
  });

  it("findByPublicId resolves the correct scope for a MANDI-scoped row", async () => {
    prismaMock.priceForecast.findUnique.mockResolvedValue(baseRow);

    const result = await repository.findByPublicId("public-1");

    expect(prismaMock.priceForecast.findUnique).toHaveBeenCalledWith({ where: { publicId: "public-1" } });
    expect(result?.scope).toEqual({ type: "MANDI", mandiId: "mandi-1" });
  });

  it("findByPublicId returns null for a missing forecast rather than throwing", async () => {
    prismaMock.priceForecast.findUnique.mockResolvedValue(null);
    const result = await repository.findByPublicId("missing");
    expect(result).toBeNull();
  });

  it("findLatestValid queries only COMPLETED, non-expired rows for the exact scope, newest first", async () => {
    prismaMock.priceForecast.findFirst.mockResolvedValue(baseRow);

    const asOf = new Date("2026-09-03T12:00:00Z");
    await repository.findLatestValid("crop-1", { type: "MANDI", mandiId: "mandi-1" }, asOf);

    expect(prismaMock.priceForecast.findFirst).toHaveBeenCalledWith({
      where: {
        cropId: "crop-1",
        scopeKey: "MANDI:mandi-1",
        status: "COMPLETED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: asOf } }],
      },
      orderBy: { generatedAt: "desc" },
    });
  });

  it("findLatestValid returns null when nothing matches", async () => {
    prismaMock.priceForecast.findFirst.mockResolvedValue(null);
    const result = await repository.findLatestValid("crop-1", { type: "CROP_WIDE" });
    expect(result).toBeNull();
  });

  it("listForCrop applies a bounded take and orders by target date descending", async () => {
    prismaMock.priceForecast.findMany.mockResolvedValue([]);

    await repository.listForCrop("crop-1");

    expect(prismaMock.priceForecast.findMany).toHaveBeenCalledWith({
      where: { cropId: "crop-1" },
      orderBy: { targetDate: "desc" },
      take: 200,
    });
  });

  it("listForCropAndMandi scopes the query to MANDI-type rows for that mandi", async () => {
    prismaMock.priceForecast.findMany.mockResolvedValue([]);

    await repository.listForCropAndMandi("crop-1", "mandi-1");

    expect(prismaMock.priceForecast.findMany).toHaveBeenCalledWith({
      where: { cropId: "crop-1", mandiId: "mandi-1", scopeType: "MANDI" },
      orderBy: { targetDate: "desc" },
      take: 200,
    });
  });

  it("findByDateRange filters by scope key and an inclusive date range, ascending", async () => {
    prismaMock.priceForecast.findMany.mockResolvedValue([]);

    const start = new Date("2026-09-01");
    const end = new Date("2026-09-30");
    await repository.findByDateRange("crop-1", { type: "REGIONAL", state: "Maharashtra" }, start, end);

    expect(prismaMock.priceForecast.findMany).toHaveBeenCalledWith({
      where: {
        cropId: "crop-1",
        scopeKey: "REGIONAL:Maharashtra:*",
        targetDate: { gte: start, lte: end },
      },
      orderBy: { targetDate: "asc" },
      take: 200,
    });
  });
});
