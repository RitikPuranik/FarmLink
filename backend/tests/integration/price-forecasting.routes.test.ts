import request from "supertest";
import express from "express";

// Mock verifyAccessToken before importing anything that uses it — same
// convention as tests/integration/sell-vs-store.routes.test.ts.
jest.mock("../../src/modules/auth/auth.utils", () => ({
  ...jest.requireActual("../../src/modules/auth/auth.utils"),
  verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }),
}));

import { createPriceForecastingRouter } from "../../src/modules/price-forecasting/price-forecasting.routes";
import { MarketDomainError, NotFoundError } from "../../src/common/errors";
import { errorHandler } from "../../src/middleware/errorHandler";

describe("Price Forecasting Routes Integration", () => {
  let app: express.Express;
  let mockService: any;
  let mockAuthRepo: any;
  let mockAuditService: any;

  const authHeader = "Bearer fake-valid-token";
  const cropId = "11111111-1111-1111-1111-111111111111";
  const mandiId = "22222222-2222-2222-2222-222222222222";
  const forecastPublicId = "33333333-3333-3333-3333-333333333333";

  const sampleForecast = {
    forecastPublicId,
    crop: { id: cropId, name: "Wheat" },
    scope: { type: "CROP_WIDE" },
    status: "COMPLETED",
    horizonDays: 7,
    targetDate: "2026-09-11",
    prediction: { targetDate: "2026-09-11", predictedPrice: 2100, lowerBound: 2000, upperBound: 2200 },
    confidence: { score: 0.65, level: "MEDIUM", sampleCount: 14 },
    metadata: {
      modelProvider: "FARMLINK_BASELINE_ENGINE",
      modelVersion: "WEIGHTED_MOVING_AVERAGE_TREND_V1",
      algorithm: "WEIGHTED_MOVING_AVERAGE_TREND_V1",
      observationsUsed: 14,
      coverageRatio: 0.9,
      historyFreshness: "FRESH",
      historyStartDate: "2026-08-21",
      historyEndDate: "2026-09-03",
      inputDataStartDate: "2026-08-01",
      inputDataEndDate: "2026-09-04",
      generatedAt: "2026-09-04T10:00:00.000Z",
      expiresAt: "2026-09-05T10:00:00.000Z",
    },
    insufficiencyReasons: [],
    limitations: ["..."],
    disclaimer: "This forecast is an analytical estimate...",
    createdAt: "2026-09-04T10:00:00.000Z",
    updatedAt: "2026-09-04T10:00:00.000Z",
  };

  beforeEach(() => {
    mockService = {
      generateForecast: jest.fn(),
      getForecast: jest.fn(),
      listForecasts: jest.fn(),
      findLatestForecast: jest.fn(),
    };
    mockAuthRepo = {
      findUserById: jest.fn().mockResolvedValue({
        id: "user-1",
        publicId: "pub-user-1",
        role: "FARMER",
        accountStatus: "ACTIVE",
      }),
    };
    mockAuditService = { record: jest.fn().mockResolvedValue(undefined) };

    const router = createPriceForecastingRouter(mockService, mockAuthRepo, mockAuditService);
    app = express();
    app.use(express.json());
    app.use("/api/price-forecasting", router);
    app.use(errorHandler);
  });

  describe("Authentication / authorization", () => {
    it("1. rejects a request with no Authorization header (401)", async () => {
      const res = await request(app).post("/api/price-forecasting/generate").send({ cropId, scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(401);
      expect(mockService.generateForecast).not.toHaveBeenCalled();
    });

    it("2. allows a FARMER", async () => {
      mockService.generateForecast.mockResolvedValue(sampleForecast);
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(200);
    });

    it("3. allows an FPO_ADMIN", async () => {
      mockAuthRepo.findUserById.mockResolvedValue({ id: "user-1", publicId: "pub-user-1", role: "FPO_ADMIN", accountStatus: "ACTIVE" });
      mockService.generateForecast.mockResolvedValue(sampleForecast);
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(200);
    });

    it("4. allows an ADMIN", async () => {
      mockAuthRepo.findUserById.mockResolvedValue({ id: "user-1", publicId: "pub-user-1", role: "ADMIN", accountStatus: "ACTIVE" });
      mockService.generateForecast.mockResolvedValue(sampleForecast);
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(200);
    });

    it("5. rejects a BUYER account (403), and never reaches the service", async () => {
      mockAuthRepo.findUserById.mockResolvedValue({ id: "user-1", publicId: "pub-user-1", role: "BUYER", accountStatus: "ACTIVE" });
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(403);
      expect(mockService.generateForecast).not.toHaveBeenCalled();
    });
  });

  describe("POST /generate — validation", () => {
    it("6. rejects an unknown crop (404 domain error, not 500)", async () => {
      mockService.generateForecast.mockRejectedValue(new MarketDomainError("Crop not found.", "CROP_NOT_FOUND", 404));
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CROP_NOT_FOUND");
    });

    it("7. rejects an unknown mandi (404 domain error)", async () => {
      mockService.generateForecast.mockRejectedValue(new MarketDomainError("Mandi not found.", "MANDI_NOT_FOUND", 404));
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "MANDI", mandiId } });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("MANDI_NOT_FOUND");
    });

    it("8. rejects an invalid scope combination — MANDI without mandiId (400)", async () => {
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "MANDI" } });
      expect(res.status).toBe(400);
      expect(mockService.generateForecast).not.toHaveBeenCalled();
    });

    it("9. rejects a REGIONAL scope missing state (400)", async () => {
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "REGIONAL" } });
      expect(res.status).toBe(400);
    });

    it("10. rejects CROP_WIDE with an unexpected mandi-specific field (400, strict schema)", async () => {
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE", mandiId } });
      expect(res.status).toBe(400);
    });

    it("11. rejects a horizon beyond the configured maximum (400)", async () => {
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" }, horizonDays: 99999 });
      expect(res.status).toBe(400);
    });

    it("12. rejects a non-uuid cropId (400)", async () => {
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId: "not-a-uuid", scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /generate — success", () => {
    it("13. generates a forecast and returns the standard response envelope", async () => {
      mockService.generateForecast.mockResolvedValue(sampleForecast);
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" }, horizonDays: 7 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { forecastPublicId, status: "COMPLETED" } });
      expect(res.body.data.prediction.predictedPrice).toBe(2100);
    });

    it("14. returns an INSUFFICIENT_DATA result as a normal 200, never a 500", async () => {
      mockService.generateForecast.mockResolvedValue({
        ...sampleForecast,
        status: "INSUFFICIENT_DATA",
        prediction: null,
        confidence: null,
        insufficiencyReasons: ["NO_HISTORICAL_DATA"],
      });
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" } });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("INSUFFICIENT_DATA");
      expect(res.body.data.insufficiencyReasons).toEqual(["NO_HISTORICAL_DATA"]);
      expect(res.body.data.prediction).toBeNull();
    });

    it("15. an unexpected service failure surfaces as 500, not silently swallowed", async () => {
      mockService.generateForecast.mockRejectedValue(new Error("unexpected database error"));
      const res = await request(app)
        .post("/api/price-forecasting/generate")
        .set("Authorization", authHeader)
        .send({ cropId, scope: { type: "CROP_WIDE" } });
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /:forecastPublicId", () => {
    it("16. retrieves a forecast by public id", async () => {
      mockService.getForecast.mockResolvedValue(sampleForecast);
      const res = await request(app).get(`/api/price-forecasting/${forecastPublicId}`).set("Authorization", authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.forecastPublicId).toBe(forecastPublicId);
    });

    it("17. returns 404 for a nonexistent forecast", async () => {
      mockService.getForecast.mockRejectedValue(new NotFoundError("Forecast not found."));
      const res = await request(app).get(`/api/price-forecasting/${forecastPublicId}`).set("Authorization", authHeader);
      expect(res.status).toBe(404);
    });

    it("18. rejects a malformed public id (400)", async () => {
      const res = await request(app).get("/api/price-forecasting/not-a-uuid").set("Authorization", authHeader);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /crops/:cropId/latest", () => {
    it("19. retrieves the latest forecast, defaulting to CROP_WIDE scope", async () => {
      mockService.findLatestForecast.mockResolvedValue(sampleForecast);
      const res = await request(app).get(`/api/price-forecasting/crops/${cropId}/latest`).set("Authorization", authHeader);
      expect(res.status).toBe(200);
      expect(mockService.findLatestForecast).toHaveBeenCalledWith(cropId, { type: "CROP_WIDE" });
    });

    it("20. accepts an explicit MANDI scope via query params", async () => {
      mockService.findLatestForecast.mockResolvedValue(sampleForecast);
      const res = await request(app)
        .get(`/api/price-forecasting/crops/${cropId}/latest`)
        .query({ scopeType: "MANDI", mandiId })
        .set("Authorization", authHeader);
      expect(res.status).toBe(200);
      expect(mockService.findLatestForecast).toHaveBeenCalledWith(cropId, { type: "MANDI", mandiId });
    });

    it("21. rejects scopeType=MANDI without mandiId (400)", async () => {
      const res = await request(app)
        .get(`/api/price-forecasting/crops/${cropId}/latest`)
        .query({ scopeType: "MANDI" })
        .set("Authorization", authHeader);
      expect(res.status).toBe(400);
    });

    it("22. returns 404 when no valid forecast exists yet", async () => {
      mockService.findLatestForecast.mockRejectedValue(new NotFoundError("No valid forecast is available yet for this crop and scope."));
      const res = await request(app).get(`/api/price-forecasting/crops/${cropId}/latest`).set("Authorization", authHeader);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /crops/:cropId — list", () => {
    it("23. lists forecasts for a crop with the standard response envelope", async () => {
      mockService.listForecasts.mockResolvedValue([sampleForecast]);
      const res = await request(app).get(`/api/price-forecasting/crops/${cropId}`).set("Authorization", authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("24. applies scopeType/limit/date-range filters from the query string", async () => {
      mockService.listForecasts.mockResolvedValue([]);
      const res = await request(app)
        .get(`/api/price-forecasting/crops/${cropId}`)
        .query({ scopeType: "REGIONAL", limit: 10, startDate: "2026-08-01", endDate: "2026-09-01" })
        .set("Authorization", authHeader);
      expect(res.status).toBe(200);
      expect(mockService.listForecasts).toHaveBeenCalledWith(
        cropId,
        expect.objectContaining({ scopeType: "REGIONAL", limit: 10 }),
      );
    });

    it("25. rejects a limit beyond the maximum (400)", async () => {
      const res = await request(app)
        .get(`/api/price-forecasting/crops/${cropId}`)
        .query({ limit: 99999 })
        .set("Authorization", authHeader);
      expect(res.status).toBe(400);
    });

    it("26. rejects mandiId combined with a non-MANDI scopeType (400)", async () => {
      const res = await request(app)
        .get(`/api/price-forecasting/crops/${cropId}`)
        .query({ scopeType: "REGIONAL", mandiId })
        .set("Authorization", authHeader);
      expect(res.status).toBe(400);
    });

    it("27. rejects an unknown crop (404)", async () => {
      mockService.listForecasts.mockRejectedValue(new MarketDomainError("Crop not found.", "CROP_NOT_FOUND", 404));
      const res = await request(app).get(`/api/price-forecasting/crops/${cropId}`).set("Authorization", authHeader);
      expect(res.status).toBe(404);
    });
  });
});
