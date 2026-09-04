jest.mock("../../src/modules/price-forecasting/price-forecasting.cache", () => ({
  getForecastCache: jest.fn().mockResolvedValue(null),
  setForecastCache: jest.fn().mockResolvedValue(undefined),
  invalidateForecastCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../src/config/posthog", () => ({ trackEvent: jest.fn() }));

import { PriceForecastingService } from "../../src/modules/price-forecasting/price-forecasting.service";
import { invalidateForecastCache } from "../../src/modules/price-forecasting/price-forecasting.cache";
import { trackEvent } from "../../src/config/posthog";
import { BASELINE_MODEL_VERSION } from "../../src/modules/price-forecasting/price-forecasting.engine.types";
import { AuthenticatedUserContext } from "../../src/modules/auth/auth.types";
import { PersistedForecast } from "../../src/modules/price-forecasting/price-forecasting.types";

const ACTOR: AuthenticatedUserContext = { id: "user-1", publicId: "pub-user-1", role: "FARMER" };
const CROP = { id: "crop-1", name: "Wheat" };
const MANDI_ROW = { id: "internal-mandi-1", publicId: "mandi-pub-1", name: "Sample Mandi", state: "MP", district: "Bhopal" };

function makeForecast(overrides: Partial<PersistedForecast> = {}): PersistedForecast {
  return {
    id: "forecast-internal-1",
    publicId: "forecast-pub-1",
    cropId: "crop-1",
    scope: { type: "CROP_WIDE" },
    targetDate: new Date("2026-09-11T00:00:00.000Z"),
    horizonDays: 7,
    status: "COMPLETED",
    output: { predictedPrice: 2100, lowerBound: 2000, upperBound: 2200 },
    confidence: { score: 0.65, sampleCount: 14 },
    model: {
      modelProvider: "FARMLINK_BASELINE_ENGINE",
      modelVersion: BASELINE_MODEL_VERSION,
      inputDataStartDate: new Date("2026-08-01T00:00:00.000Z"),
      inputDataEndDate: new Date("2026-09-04T00:00:00.000Z"),
      generatedAt: new Date("2026-09-04T10:00:00.000Z"),
      expiresAt: new Date("2026-09-05T10:00:00.000Z"),
      metadata: { algorithm: BASELINE_MODEL_VERSION, historicalObservationCount: 14, coverageRatio: 0.9 },
    },
    createdAt: new Date("2026-09-04T10:00:00.000Z"),
    updatedAt: new Date("2026-09-04T10:00:00.000Z"),
    ...overrides,
  };
}

function makeDeps() {
  const generation = { generateForecast: jest.fn() };
  const repository = {
    findByPublicId: jest.fn(),
    findLatestValid: jest.fn(),
    listForCrop: jest.fn().mockResolvedValue([]),
    listForCropAndMandi: jest.fn().mockResolvedValue([]),
    findByDateRange: jest.fn().mockResolvedValue([]),
  };
  const marketIntelligence = { crop: jest.fn(), mandi: jest.fn() };
  const prisma = { mandi: { findUnique: jest.fn(), findMany: jest.fn() } };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new PriceForecastingService(generation as any, repository as any, marketIntelligence as any, prisma as any, audit as any);
  return { service, generation, repository, marketIntelligence, prisma, audit };
}

beforeEach(() => jest.clearAllMocks());

describe("PriceForecastingService.generateForecast — crop/scope validation", () => {
  it("throws CROP_NOT_FOUND when the crop does not exist", async () => {
    const { service, marketIntelligence } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(null);

    await expect(service.generateForecast({ cropId: "missing-crop", scope: { type: "CROP_WIDE" } }, ACTOR)).rejects.toMatchObject({
      code: "CROP_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("throws MANDI_NOT_FOUND when a MANDI scope references a nonexistent mandi", async () => {
    const { service, marketIntelligence } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    marketIntelligence.mandi.mockResolvedValue(null);

    await expect(
      service.generateForecast({ cropId: "crop-1", scope: { type: "MANDI", mandiId: "missing-mandi" } }, ACTOR),
    ).rejects.toMatchObject({ code: "MANDI_NOT_FOUND", statusCode: 404 });
  });

  it("resolves a MANDI scope's public id to the internal id before generating", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    marketIntelligence.mandi.mockResolvedValue(MANDI_ROW);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockResolvedValue(makeForecast({ scope: { type: "MANDI", mandiId: MANDI_ROW.id } }));

    await service.generateForecast({ cropId: "crop-1", scope: { type: "MANDI", mandiId: MANDI_ROW.publicId } }, ACTOR);

    expect(generation.generateForecast).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { type: "MANDI", mandiId: MANDI_ROW.id } }),
    );
  });
});

describe("PriceForecastingService.generateForecast — scope coverage", () => {
  it("generates for a MANDI scope", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    marketIntelligence.mandi.mockResolvedValue(MANDI_ROW);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockResolvedValue(makeForecast({ scope: { type: "MANDI", mandiId: MANDI_ROW.id } }));

    const dto = await service.generateForecast({ cropId: "crop-1", scope: { type: "MANDI", mandiId: MANDI_ROW.publicId } }, ACTOR);
    expect(dto.scope).toEqual({ type: "MANDI", mandi: { publicId: MANDI_ROW.publicId, name: MANDI_ROW.name, state: MANDI_ROW.state, district: MANDI_ROW.district } });
  });

  it("generates for a REGIONAL scope", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockResolvedValue(makeForecast({ scope: { type: "REGIONAL", state: "Madhya Pradesh" } }));

    const dto = await service.generateForecast({ cropId: "crop-1", scope: { type: "REGIONAL", state: "Madhya Pradesh" } }, ACTOR);
    expect(dto.scope).toEqual({ type: "REGIONAL", state: "Madhya Pradesh", district: null });
    expect(marketIntelligence.mandi).not.toHaveBeenCalled();
  });

  it("generates for a CROP_WIDE scope", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockResolvedValue(makeForecast());

    const dto = await service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" } }, ACTOR);
    expect(dto.scope).toEqual({ type: "CROP_WIDE" });
  });
});

describe("PriceForecastingService.generateForecast — outcomes", () => {
  it("handles insufficient historical data gracefully (no throw, status surfaced honestly)", async () => {
    const { service, marketIntelligence, repository, generation, audit } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockResolvedValue(
      makeForecast({ status: "INSUFFICIENT_DATA", output: null, confidence: null, model: { ...makeForecast().model, metadata: { insufficiencyReasons: ["NO_HISTORICAL_DATA"] } } }),
    );

    const dto = await service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" } }, ACTOR);

    expect(dto.status).toBe("INSUFFICIENT_DATA");
    expect(dto.insufficiencyReasons).toEqual(["NO_HISTORICAL_DATA"]);
    expect(audit.record).not.toHaveBeenCalled(); // only COMPLETED generations are audited
    expect(trackEvent).toHaveBeenCalledWith("forecast_insufficient_data", ACTOR.id, expect.any(Object));
  });

  it("marks FAILED (rethrows) and tracks forecast_failed when the algorithm/persistence throws", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockRejectedValue(new Error("db write failed"));

    await expect(service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" } }, ACTOR)).rejects.toThrow("db write failed");
    expect(trackEvent).toHaveBeenCalledWith("forecast_failed", ACTOR.id, expect.any(Object));
  });

  it("rejects invalid algorithm output rather than silently serving it (defense-in-depth)", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockResolvedValue(makeForecast({ output: { predictedPrice: -100, lowerBound: null, upperBound: null } }));

    await expect(service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" } }, ACTOR)).rejects.toThrow();
  });

  it("audits and invalidates the cache exactly once for a freshly COMPLETED generation", async () => {
    const { service, marketIntelligence, repository, generation, audit } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([]);
    generation.generateForecast.mockResolvedValue(makeForecast());

    await service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" } }, ACTOR);

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "PRICE_FORECAST_GENERATED", actorUserId: ACTOR.id }));
    expect(invalidateForecastCache).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith("forecast_generated", ACTOR.id, expect.any(Object));
  });
});

describe("PriceForecastingService.generateForecast — existing forecast reuse / idempotency", () => {
  it("reuses an existing COMPLETED forecast for the same crop+scope+targetDate+modelVersion without calling generation", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    const existing = makeForecast({ publicId: "already-completed" });
    repository.findByDateRange.mockResolvedValue([existing]);

    const dto = await service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" }, horizonDays: 7 }, ACTOR);

    expect(dto.forecastPublicId).toBe("already-completed");
    expect(generation.generateForecast).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith("forecast_reused", ACTOR.id, expect.any(Object));
  });

  it("ignores a matching row still stuck in GENERATING and proceeds through generation (resume behavior)", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([makeForecast({ status: "GENERATING", output: null, confidence: null })]);
    generation.generateForecast.mockResolvedValue(makeForecast({ publicId: "freshly-completed" }));

    const dto = await service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" } }, ACTOR);

    expect(generation.generateForecast).toHaveBeenCalledTimes(1);
    expect(dto.forecastPublicId).toBe("freshly-completed");
  });

  it("ignores a match from a different (older) model version", async () => {
    const { service, marketIntelligence, repository, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findByDateRange.mockResolvedValue([
      makeForecast({ model: { ...makeForecast().model, modelVersion: "SOME_OLDER_VERSION" } }),
    ]);
    generation.generateForecast.mockResolvedValue(makeForecast({ publicId: "freshly-completed" }));

    const dto = await service.generateForecast({ cropId: "crop-1", scope: { type: "CROP_WIDE" } }, ACTOR);

    expect(generation.generateForecast).toHaveBeenCalledTimes(1);
    expect(dto.forecastPublicId).toBe("freshly-completed");
  });
});

describe("PriceForecastingService.getForecast", () => {
  it("returns the mapped forecast for a known publicId", async () => {
    const { service, repository, marketIntelligence } = makeDeps();
    repository.findByPublicId.mockResolvedValue(makeForecast());
    marketIntelligence.crop.mockResolvedValue(CROP);

    const dto = await service.getForecast("forecast-pub-1");
    expect(dto.forecastPublicId).toBe("forecast-pub-1");
  });

  it("throws NotFoundError for an unknown publicId", async () => {
    const { service, repository } = makeDeps();
    repository.findByPublicId.mockResolvedValue(null);

    await expect(service.getForecast("nonexistent")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("never recomputes — the generation service is never touched", async () => {
    const { service, repository, marketIntelligence, generation } = makeDeps();
    repository.findByPublicId.mockResolvedValue(makeForecast());
    marketIntelligence.crop.mockResolvedValue(CROP);

    await service.getForecast("forecast-pub-1");
    expect(generation.generateForecast).not.toHaveBeenCalled();
  });
});

describe("PriceForecastingService.listForecasts", () => {
  it("uses the mandi-specific bounded query when mandiId is given", async () => {
    const { service, repository, marketIntelligence } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    marketIntelligence.mandi.mockResolvedValue(MANDI_ROW);
    repository.listForCropAndMandi.mockResolvedValue([makeForecast()]);

    await service.listForecasts("crop-1", { mandiId: MANDI_ROW.publicId });

    expect(repository.listForCropAndMandi).toHaveBeenCalledWith("crop-1", MANDI_ROW.id, { limit: undefined });
    expect(repository.listForCrop).not.toHaveBeenCalled();
  });

  it("filters by scopeType in-memory over the bounded listForCrop result when no mandiId is given", async () => {
    const { service, repository, marketIntelligence } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.listForCrop.mockResolvedValue([
      makeForecast({ scope: { type: "CROP_WIDE" }, publicId: "a" }),
      makeForecast({ scope: { type: "REGIONAL", state: "MP" }, publicId: "b" }),
    ]);

    const dtos = await service.listForecasts("crop-1", { scopeType: "REGIONAL" });

    expect(dtos).toHaveLength(1);
    expect(dtos[0].forecastPublicId).toBe("b");
  });

  it("never recomputes for a list request", async () => {
    const { service, repository, marketIntelligence, generation } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.listForCrop.mockResolvedValue([]);

    await service.listForecasts("crop-1", {});
    expect(generation.generateForecast).not.toHaveBeenCalled();
  });

  it("throws CROP_NOT_FOUND for an unknown crop", async () => {
    const { service, marketIntelligence } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(null);

    await expect(service.listForecasts("missing", {})).rejects.toMatchObject({ code: "CROP_NOT_FOUND" });
  });
});

describe("PriceForecastingService.findLatestForecast", () => {
  it("returns the latest valid forecast for a scope", async () => {
    const { service, repository, marketIntelligence } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findLatestValid.mockResolvedValue(makeForecast());

    const dto = await service.findLatestForecast("crop-1", { type: "CROP_WIDE" });
    expect(dto.forecastPublicId).toBe("forecast-pub-1");
  });

  it("throws NotFoundError when no valid forecast exists yet", async () => {
    const { service, repository, marketIntelligence } = makeDeps();
    marketIntelligence.crop.mockResolvedValue(CROP);
    repository.findLatestValid.mockResolvedValue(null);

    await expect(service.findLatestForecast("crop-1", { type: "CROP_WIDE" })).rejects.toMatchObject({ statusCode: 404 });
  });
});
