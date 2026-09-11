import request from "supertest";
import express from "express";

jest.mock("../../src/modules/auth/auth.utils", () => ({
  ...jest.requireActual("../../src/modules/auth/auth.utils"),
  verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }),
}));
jest.mock("../../src/config/posthog", () => ({ trackEvent: jest.fn() }));

import { errorHandler } from "../../src/middleware/errorHandler";
import { LogisticsRequestService } from "../../src/modules/logistics/logistics-request.service";
import { LogisticsQuoteService } from "../../src/modules/logistics/logistics-quote.service";
import { LogisticsAuthorizationService } from "../../src/modules/logistics/logistics.authorization";
import { FpoAuthorizationService } from "../../src/modules/fpo/fpo.authorization";
import { FarmerProfileResolver } from "../../src/modules/farmers/farmer-profile.resolver";
import { TransporterAuthorizationService } from "../../src/modules/transporters/transporter.authorization";
import { HaversineRouteDistanceProvider } from "../../src/modules/logistics/route-distance.provider";
import { LogisticsCostEstimator } from "../../src/modules/logistics/logistics-cost-estimator";
import { VehicleEligibilityService } from "../../src/modules/logistics/vehicle-eligibility.service";
import { DefaultProviderReliabilityService } from "../../src/modules/logistics/provider-reliability.service";
import { LogisticsOptimizationEngine } from "../../src/modules/logistics/logistics-optimization.engine";
import { createLogisticsRequestRouter } from "../../src/modules/logistics/logistics-request.routes";
import { createLogisticsQuoteRouter } from "../../src/modules/logistics/logistics-quote.routes";

/**
 * Mocked-repository integration test — same pattern as
 * transporter-vehicle-network.routes.test.ts: real routers/controllers/
 * services/authorization/deterministic engines wired together and driven
 * over HTTP via supertest, with only the Prisma-backed repository layer
 * replaced by hand-written jest mocks. This exercises real request
 * parsing, Zod validation, RBAC, authorization, and orchestration logic —
 * everything except the actual SQL — without needing a generated Prisma
 * Client or a live database.
 */

const now = new Date("2026-01-01T00:00:00Z");

function makeLot(overrides: Partial<any> = {}) {
  return {
    id: "lot-1",
    publicId: "10000000-0000-0000-0000-000000000001",
    ownerType: "FARMER",
    farmerId: "farmer-profile-1",
    fpoId: null,
    cropId: "crop-1",
    availableQuantityKg: 5000,
    originVillage: "Sanwer",
    originDistrict: "Ujjain",
    originState: "Madhya Pradesh",
    ...overrides,
  };
}

function makeRequestRecord(overrides: Partial<any> = {}) {
  return {
    id: "request-1",
    publicId: "20000000-0000-0000-0000-000000000001",
    lotId: "lot-1",
    requesterUserId: "user-1",
    cropId: "crop-1",
    requiredQuantityKg: 2000,
    quantityUnit: "KG",
    pickupAddress: null,
    pickupVillage: "Sanwer",
    pickupDistrict: "Ujjain",
    pickupState: "Madhya Pradesh",
    pickupPincode: null,
    pickupLatitude: 23.1793,
    pickupLongitude: 75.7849,
    destinationAddress: null,
    destinationDistrict: "Indore",
    destinationState: "Madhya Pradesh",
    destinationPincode: null,
    destinationLatitude: 22.7196,
    destinationLongitude: 75.8577,
    requestedPickupAt: null,
    deliveryDeadline: null,
    requiredCapabilities: [],
    requiresRefrigeration: false,
    specialInstructions: null,
    status: "OPEN",
    estimatedDistanceKm: null,
    estimatedDurationMinutes: null,
    estimatedCost: null,
    estimatedCostCurrency: "INR",
    estimateCalculatedAt: null,
    recommendedQuoteId: null,
    acceptedQuoteId: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeQuoteRecord(overrides: Partial<any> = {}) {
  return {
    id: "quote-1",
    publicId: "30000000-0000-0000-0000-000000000001",
    logisticsRequestId: "request-1",
    transportProviderId: "transporter-1",
    vehicleId: "vehicle-1",
    quotedAmount: 3200,
    currency: "INR",
    estimatedPickupTime: null,
    estimatedDeliveryTime: null,
    estimatedDistanceKm: 55,
    estimatedDurationMinutes: 90,
    notes: null,
    status: "SUBMITTED",
    validUntil: new Date(Date.now() + 72 * 60 * 60 * 1000),
    submittedAt: now,
    acceptedAt: null,
    rejectedAt: null,
    withdrawnAt: null,
    expiredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeVehicleRecord(overrides: Partial<any> = {}) {
  return {
    id: "vehicle-1",
    publicId: "40000000-0000-0000-0000-000000000001",
    transporterId: "transporter-1",
    registrationNumber: "MP09AB1234",
    normalizedRegistrationNumber: "MP09AB1234",
    vehicleType: "MEDIUM_TRUCK",
    capacityUnit: "KG",
    capacityKg: 5000,
    capabilities: [],
    isRefrigerated: false,
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    availabilityStatus: "AVAILABLE",
    availabilityUpdatedAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeProviderRecord(overrides: Partial<any> = {}) {
  return {
    id: "transporter-1",
    publicId: "50000000-0000-0000-0000-000000000001",
    userId: "user-2",
    businessName: "Acme Logistics",
    verificationStatus: "VERIFIED",
    isActive: true,
    ...overrides,
  };
}

describe("Logistics routes integration (mocked repository layer)", () => {
  let app: express.Express;
  let currentUser: { id: string; publicId: string; role: string };

  let mockRequests: any;
  let mockQuotes: any;
  let mockCropLots: any;
  let mockFarmerProfileRepo: any;
  let mockFpoAdminRepo: any;
  let mockVehicleDiscovery: any;
  let mockVehicles: any;
  let mockTransporters: any;
  let mockOptimizationResults: any;
  let mockAuthRepo: any;
  let mockAuditService: any;

  beforeEach(() => {
    currentUser = { id: "user-1", publicId: "pub-user-1", role: "FARMER" };

    mockRequests = {
      create: jest.fn(),
      findById: jest.fn(),
      findByPublicId: jest.fn(),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      update: jest.fn(),
      applyEstimate: jest.fn(),
      setRecommendedQuote: jest.fn(),
      transition: jest.fn(),
    };
    mockQuotes = {
      create: jest.fn(),
      findById: jest.fn(),
      findByPublicId: jest.fn(),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listByRequestId: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      transition: jest.fn(),
      hasConflictingAcceptedQuote: jest.fn().mockResolvedValue(false),
      acceptQuoteTransaction: jest.fn(),
    };
    mockCropLots = { findById: jest.fn(), findByPublicId: jest.fn() };
    mockFarmerProfileRepo = {
      findByUserId: jest.fn().mockResolvedValue({ id: "farmer-profile-1", userId: "user-1" }),
      create: jest.fn(),
    };
    mockFpoAdminRepo = { findActiveByUserAndFpo: jest.fn().mockResolvedValue(null) };
    mockVehicleDiscovery = { findCandidates: jest.fn().mockResolvedValue([]) };
    mockVehicles = {
      findById: jest.fn(),
      findByPublicId: jest.fn(),
      updateAvailability: jest.fn(),
    };
    mockTransporters = {
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findByPublicId: jest.fn(),
    };
    mockOptimizationResults = { create: jest.fn(), findLatestByRequestId: jest.fn() };
    mockAuthRepo = { findUserById: jest.fn().mockImplementation(() => Promise.resolve({ ...currentUser, accountStatus: "ACTIVE" })) };
    mockAuditService = { record: jest.fn().mockResolvedValue(undefined) };

    const fpoAuthorization = new FpoAuthorizationService(mockFpoAdminRepo);
    const logisticsAuthorization = new LogisticsAuthorizationService(fpoAuthorization);
    const farmerProfiles = new FarmerProfileResolver(mockFarmerProfileRepo);
    const transporterAuthorization = new TransporterAuthorizationService(mockTransporters);
    const routeDistanceProvider = new HaversineRouteDistanceProvider({ roadDistanceMultiplier: 1.25, averageSpeedKmph: 35 });
    const costEstimator = new LogisticsCostEstimator({
      baseCostInr: 500,
      ratePerKmInr: 18,
      minimumTripCostInr: 800,
      loadingCostInr: 200,
      unloadingCostInr: 200,
      tollEstimatePerKmInr: 1.5,
      refrigerationSurchargePercent: 15,
    });
    const vehicleEligibility = new VehicleEligibilityService();
    const reliability = new DefaultProviderReliabilityService();
    const optimizationEngine = new LogisticsOptimizationEngine();

    const requestService = new LogisticsRequestService(
      mockRequests,
      mockQuotes,
      mockCropLots,
      farmerProfiles,
      logisticsAuthorization,
      routeDistanceProvider,
      costEstimator,
      mockVehicleDiscovery,
      vehicleEligibility,
      mockVehicles,
      mockTransporters,
      reliability,
      optimizationEngine,
      mockOptimizationResults,
      mockAuditService,
    );
    const quoteService = new LogisticsQuoteService(
      mockQuotes,
      mockRequests,
      mockCropLots,
      farmerProfiles,
      logisticsAuthorization,
      transporterAuthorization,
      mockTransporters,
      mockVehicles,
      vehicleEligibility,
      mockAuditService,
    );

    app = express();
    app.use(express.json());
    app.use("/api", createLogisticsRequestRouter(requestService, mockAuthRepo, mockAuditService));
    app.use("/api", createLogisticsQuoteRouter(quoteService, mockAuthRepo, mockAuditService));
    app.use(errorHandler);
  });

  const authHeader = "Bearer fake-valid-token";

  describe("authentication", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/api/logistics/requests/20000000-0000-0000-0000-000000000001");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/logistics/requests", () => {
    it("creates a request for the farmer's own lot", async () => {
      mockCropLots.findByPublicId.mockResolvedValue(makeLot());
      mockRequests.create.mockResolvedValue(makeRequestRecord());

      const res = await request(app)
        .post("/api/logistics/requests")
        .set("Authorization", authHeader)
        .send({
          lotId: "10000000-0000-0000-0000-000000000001",
          requiredQuantityValue: 2000,
          requiredQuantityUnit: "KG",
          destination: { district: "Indore", state: "Madhya Pradesh" },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("OPEN");
      expect(mockRequests.create).toHaveBeenCalled();
    });

    it("rejects creating a request for a lot the farmer does not own (403)", async () => {
      mockCropLots.findByPublicId.mockResolvedValue(makeLot({ farmerId: "someone-elses-profile" }));

      const res = await request(app)
        .post("/api/logistics/requests")
        .set("Authorization", authHeader)
        .send({
          lotId: "10000000-0000-0000-0000-000000000001",
          requiredQuantityValue: 2000,
          requiredQuantityUnit: "KG",
          destination: { district: "Indore", state: "Madhya Pradesh" },
        });

      expect(res.status).toBe(403);
      expect(mockRequests.create).not.toHaveBeenCalled();
    });

    it("rejects a quantity exceeding the lot's available quantity (422)", async () => {
      mockCropLots.findByPublicId.mockResolvedValue(makeLot({ availableQuantityKg: 100 }));

      const res = await request(app)
        .post("/api/logistics/requests")
        .set("Authorization", authHeader)
        .send({
          lotId: "10000000-0000-0000-0000-000000000001",
          requiredQuantityValue: 2000,
          requiredQuantityUnit: "KG",
          destination: { district: "Indore", state: "Madhya Pradesh" },
        });

      expect(res.status).toBe(422);
    });

    it("a TRANSPORTER cannot create a farmer logistics request (403 at RBAC layer)", async () => {
      currentUser = { id: "user-1", publicId: "pub-user-1", role: "TRANSPORTER" };
      const res = await request(app)
        .post("/api/logistics/requests")
        .set("Authorization", authHeader)
        .send({
          lotId: "10000000-0000-0000-0000-000000000001",
          requiredQuantityValue: 2000,
          requiredQuantityUnit: "KG",
          destination: { district: "Indore", state: "Madhya Pradesh" },
        });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/logistics/requests/:publicId/calculate", () => {
    it("calculates a distance/cost estimate and reports suitable vehicle count", async () => {
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord());
      mockCropLots.findById.mockResolvedValue(makeLot());
      mockVehicleDiscovery.findCandidates.mockResolvedValue([
        {
          vehicleId: "vehicle-1",
          vehiclePublicId: "40000000-0000-0000-0000-000000000001",
          vehicleType: "MEDIUM_TRUCK",
          capacityKg: 5000,
          capabilities: [],
          isRefrigerated: false,
          status: "ACTIVE",
          verificationStatus: "VERIFIED",
          availabilityStatus: "AVAILABLE",
          transporterId: "transporter-1",
          transporterPublicId: "50000000-0000-0000-0000-000000000001",
          transporterIsActive: true,
          transporterVerificationStatus: "VERIFIED",
          transporterBusinessName: "Acme Logistics",
        },
      ]);
      mockRequests.applyEstimate.mockResolvedValue(makeRequestRecord());

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/calculate")
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.isEstimated).toBe(true);
      expect(res.body.data.estimatedDistanceKm).toBeGreaterThan(0);
      expect(res.body.data.suitableVehicleCount).toBe(1);
      expect(mockRequests.applyEstimate).toHaveBeenCalled();
    });

    it("rejects calculation when pickup/destination coordinates are missing (422)", async () => {
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord({ destinationLatitude: null, destinationLongitude: null }));
      mockCropLots.findById.mockResolvedValue(makeLot());

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/calculate")
        .set("Authorization", authHeader);

      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/logistics/requests/:publicId/quotes", () => {
    it("a TRANSPORTER submits a quote for their own eligible vehicle", async () => {
      currentUser = { id: "user-2", publicId: "pub-user-2", role: "TRANSPORTER" };
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord());
      mockTransporters.findByUserId.mockResolvedValue(makeProviderRecord());
      mockVehicles.findByPublicId.mockResolvedValue(makeVehicleRecord());
      mockQuotes.create.mockResolvedValue(makeQuoteRecord());

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/quotes")
        .set("Authorization", authHeader)
        .send({ vehicleId: "40000000-0000-0000-0000-000000000001", quotedAmount: 3200 });

      expect(res.status).toBe(201);
      expect(mockQuotes.create).toHaveBeenCalled();
    });

    it("rejects a quote using a vehicle that belongs to a different transporter (403)", async () => {
      currentUser = { id: "user-2", publicId: "pub-user-2", role: "TRANSPORTER" };
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord());
      mockTransporters.findByUserId.mockResolvedValue(makeProviderRecord({ id: "transporter-1" }));
      mockVehicles.findByPublicId.mockResolvedValue(makeVehicleRecord({ transporterId: "someone-elses-transporter" }));

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/quotes")
        .set("Authorization", authHeader)
        .send({ vehicleId: "40000000-0000-0000-0000-000000000001", quotedAmount: 3200 });

      expect(res.status).toBe(403);
      expect(mockQuotes.create).not.toHaveBeenCalled();
    });

    it("rejects a quote for an ineligible vehicle (insufficient capacity) with 422", async () => {
      currentUser = { id: "user-2", publicId: "pub-user-2", role: "TRANSPORTER" };
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord({ requiredQuantityKg: 10000 }));
      mockTransporters.findByUserId.mockResolvedValue(makeProviderRecord());
      mockVehicles.findByPublicId.mockResolvedValue(makeVehicleRecord({ capacityKg: 5000 }));

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/quotes")
        .set("Authorization", authHeader)
        .send({ vehicleId: "40000000-0000-0000-0000-000000000001", quotedAmount: 3200 });

      expect(res.status).toBe(422);
    });

    it("rejects a new quote once the request is no longer OPEN (422)", async () => {
      currentUser = { id: "user-2", publicId: "pub-user-2", role: "TRANSPORTER" };
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord({ status: "QUOTE_ACCEPTED" }));

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/quotes")
        .set("Authorization", authHeader)
        .send({ vehicleId: "40000000-0000-0000-0000-000000000001", quotedAmount: 3200 });

      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/logistics/quotes/:publicId/accept", () => {
    it("accepts a quote and reserves the vehicle", async () => {
      const quote = makeQuoteRecord();
      mockQuotes.findByPublicId.mockResolvedValue(quote);
      mockRequests.findById.mockResolvedValue(makeRequestRecord());
      mockCropLots.findById.mockResolvedValue(makeLot());
      mockQuotes.acceptQuoteTransaction.mockResolvedValue({ accepted: { ...quote, status: "ACCEPTED" }, rejectedQuoteIds: [] });

      const res = await request(app)
        .post("/api/logistics/quotes/30000000-0000-0000-0000-000000000001/accept")
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ACCEPTED");
      expect(mockVehicles.updateAvailability).toHaveBeenCalledWith("vehicle-1", "RESERVED");
    });

    it("returns an explainable 422 when the accept transaction loses the race", async () => {
      const quote = makeQuoteRecord();
      mockQuotes.findByPublicId.mockResolvedValue(quote);
      mockRequests.findById.mockResolvedValue(makeRequestRecord({ status: "QUOTE_ACCEPTED" }));
      mockCropLots.findById.mockResolvedValue(makeLot());
      mockQuotes.acceptQuoteTransaction.mockResolvedValue({ accepted: null, rejectedQuoteIds: [] });

      const res = await request(app)
        .post("/api/logistics/quotes/30000000-0000-0000-0000-000000000001/accept")
        .set("Authorization", authHeader);

      expect(res.status).toBe(422);
    });

    it("a TRANSPORTER cannot accept a quote (403 at RBAC layer)", async () => {
      currentUser = { id: "user-2", publicId: "pub-user-2", role: "TRANSPORTER" };
      const res = await request(app)
        .post("/api/logistics/quotes/30000000-0000-0000-0000-000000000001/accept")
        .set("Authorization", authHeader);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/logistics/requests/:publicId/optimize", () => {
    it("ranks quotes deterministically and returns a recommendation", async () => {
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord());
      mockCropLots.findById.mockResolvedValue(makeLot());
      mockQuotes.listByRequestId.mockResolvedValue([
        makeQuoteRecord({ id: "quote-1", publicId: "30000000-0000-0000-0000-000000000001", quotedAmount: 3200 }),
        makeQuoteRecord({ id: "quote-2", publicId: "30000000-0000-0000-0000-000000000002", quotedAmount: 2800 }),
      ]);
      mockVehicles.findById.mockResolvedValue(makeVehicleRecord());
      mockOptimizationResults.create.mockResolvedValue({});
      mockRequests.setRecommendedQuote.mockResolvedValue(makeRequestRecord());

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/optimize")
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.algorithmVersion).toBe("v1");
      expect(res.body.data.recommended).not.toBeNull();
      expect(mockOptimizationResults.create).toHaveBeenCalled();
    });

    it("rejects optimizing a request with no active quotes (422)", async () => {
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord());
      mockCropLots.findById.mockResolvedValue(makeLot());
      mockQuotes.listByRequestId.mockResolvedValue([]);

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/optimize")
        .set("Authorization", authHeader);

      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/logistics/requests/:publicId/cancel", () => {
    it("cancels an open request", async () => {
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord());
      mockCropLots.findById.mockResolvedValue(makeLot());
      mockRequests.transition.mockResolvedValue(makeRequestRecord({ status: "CANCELLED", cancelledAt: now }));

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/cancel")
        .set("Authorization", authHeader)
        .send({ reason: "No longer needed" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CANCELLED");
    });

    it("rejects cancelling an already-cancelled request (422)", async () => {
      mockRequests.findByPublicId.mockResolvedValue(makeRequestRecord({ status: "CANCELLED" }));
      mockCropLots.findById.mockResolvedValue(makeLot());

      const res = await request(app)
        .post("/api/logistics/requests/20000000-0000-0000-0000-000000000001/cancel")
        .set("Authorization", authHeader);

      expect(res.status).toBe(422);
    });
  });
});
