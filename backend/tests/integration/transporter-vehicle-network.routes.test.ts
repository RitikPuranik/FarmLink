import request from "supertest";
import express from "express";

jest.mock("../../src/modules/auth/auth.utils", () => ({
  ...jest.requireActual("../../src/modules/auth/auth.utils"),
  verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }),
}));
jest.mock("../../src/config/posthog", () => ({ trackEvent: jest.fn() }));

import { createTransporterRouter } from "../../src/modules/transporters/transporter.routes";
import { createVehicleRouter } from "../../src/modules/transporters/vehicle.routes";
import { createAdminTransporterRouter } from "../../src/modules/transporters/admin-transporter.routes";
import { TransporterAuthorizationService } from "../../src/modules/transporters/transporter.authorization";
import { TransporterService } from "../../src/modules/transporters/transporter.service";
import { VehicleService } from "../../src/modules/transporters/vehicle.service";
import { errorHandler } from "../../src/middleware/errorHandler";

function makeProfile(overrides: Partial<any> = {}) {
  return {
    id: "transporter-1",
    publicId: "11111111-1111-1111-1111-111111111111",
    userId: "user-1",
    businessName: "Acme Logistics",
    contactName: "Ravi",
    contactPhone: "9999999999",
    contactEmail: "ravi@example.com",
    verificationStatus: "PENDING",
    phoneVerified: false,
    isActive: true,
    metadata: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<any> = {}) {
  return {
    id: "vehicle-1",
    publicId: "22222222-2222-2222-2222-222222222222",
    transporterId: "transporter-1",
    registrationNumber: "MH12AB1234",
    normalizedRegistrationNumber: "MH12AB1234",
    vehicleType: "MEDIUM_TRUCK",
    capacityUnit: "KG",
    capacityKg: 5000,
    capabilities: [],
    isRefrigerated: false,
    status: "ACTIVE",
    verificationStatus: "PENDING",
    availabilityStatus: "UNAVAILABLE",
    availabilityUpdatedAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("Transporter & Vehicle Network Routes Integration", () => {
  let app: express.Express;
  let mockTransporters: any;
  let mockServiceAreas: any;
  let mockVehiclesRepo: any;
  let mockAuthRepo: any;
  let mockAuditService: any;
  let currentUser: { id: string; publicId: string; role: string };

  beforeEach(() => {
    currentUser = { id: "user-1", publicId: "pub-user-1", role: "TRANSPORTER" };

    mockTransporters = {
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findByPublicId: jest.fn(),
      create: jest.fn(),
      updateProfile: jest.fn(),
      updateVerificationStatus: jest.fn(),
      search: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      countVehicles: jest.fn().mockResolvedValue(0),
      countVehiclesForMany: jest.fn().mockResolvedValue({}),
      listServiceAreas: jest.fn().mockResolvedValue([]),
      listServiceAreasForMany: jest.fn().mockResolvedValue({}),
    };
    mockServiceAreas = {
      create: jest.fn(),
      findById: jest.fn(),
      listByTransporter: jest.fn().mockResolvedValue([]),
      remove: jest.fn(),
    };
    mockVehiclesRepo = {
      create: jest.fn(),
      createMany: jest.fn(),
      findById: jest.fn(),
      findByPublicId: jest.fn(),
      findByNormalizedRegistrationNumber: jest.fn(),
      findByNormalizedRegistrationNumbers: jest.fn().mockResolvedValue([]),
      listByTransporter: jest.fn(),
      discover: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateStatus: jest.fn(),
      updateAvailability: jest.fn(),
      updateVerification: jest.fn(),
      isRegistrationTaken: jest.fn().mockResolvedValue(false),
    };
    mockAuthRepo = {
      findUserById: jest.fn().mockImplementation(() =>
        Promise.resolve({ ...currentUser, accountStatus: "ACTIVE" }),
      ),
    };
    mockAuditService = { record: jest.fn().mockResolvedValue(undefined) };

    const authorization = new TransporterAuthorizationService(mockTransporters);
    const transporterService = new TransporterService(
      mockTransporters,
      mockServiceAreas,
      mockVehiclesRepo,
      authorization,
      mockAuditService,
    );
    const vehicleService = new VehicleService(mockVehiclesRepo, authorization, mockAuditService);

    app = express();
    app.use(express.json());
    app.use("/api", createTransporterRouter(transporterService, mockAuthRepo, mockAuditService));
    app.use("/api", createVehicleRouter(vehicleService, mockAuthRepo, mockAuditService));
    app.use("/api/admin", createAdminTransporterRouter(transporterService, vehicleService, mockAuthRepo, mockAuditService));
    app.use(errorHandler);
  });

  const authHeader = "Bearer fake-valid-token";

  describe("authentication", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/api/transporter-profiles/me");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/transporter-profiles", () => {
    it("creates a profile", async () => {
      mockTransporters.findByUserId.mockResolvedValue(null);
      mockTransporters.create.mockResolvedValue(makeProfile());

      const res = await request(app)
        .post("/api/transporter-profiles")
        .set("Authorization", authHeader)
        .send({ businessName: "Acme Logistics" });

      expect(res.status).toBe(201);
      expect(res.body.data.verificationStatus).toBe("PENDING");
    });

    it("rejects a duplicate profile with 409", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());

      const res = await request(app)
        .post("/api/transporter-profiles")
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(409);
    });

    it("rejects a FARMER trying to create a transporter profile", async () => {
      currentUser.role = "FARMER";

      const res = await request(app)
        .post("/api/transporter-profiles")
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  describe("GET/PATCH /api/transporter-profiles/me", () => {
    it("returns the caller's own profile", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());

      const res = await request(app).get("/api/transporter-profiles/me").set("Authorization", authHeader);
      expect(res.status).toBe(200);
      expect(res.body.data.transporterId).toBe("11111111-1111-1111-1111-111111111111");
    });

    it("updates the caller's own profile", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());
      mockTransporters.updateProfile.mockResolvedValue(makeProfile({ businessName: "New Name" }));

      const res = await request(app)
        .patch("/api/transporter-profiles/me")
        .set("Authorization", authHeader)
        .send({ businessName: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.data.businessName).toBe("New Name");
    });
  });

  describe("POST /api/vehicles", () => {
    it("registers a vehicle", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());
      mockVehiclesRepo.create.mockResolvedValue(makeVehicle());

      const res = await request(app)
        .post("/api/vehicles")
        .set("Authorization", authHeader)
        .send({ registrationNumber: "MH-12-AB-1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" });

      expect(res.status).toBe(201);
      expect(res.body.data.registrationNumber).toBe("MH12AB1234");
    });

    it("rejects a duplicate registration with 409", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());
      mockVehiclesRepo.isRegistrationTaken.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/vehicles")
        .set("Authorization", authHeader)
        .send({ registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" });

      expect(res.status).toBe(409);
    });

    it("rejects invalid capacity with 400 (schema-level validation)", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());

      const res = await request(app)
        .post("/api/vehicles")
        .set("Authorization", authHeader)
        .send({ registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: -5, capacityUnit: "KG" });

      expect(res.status).toBe(400);
    });

    it("rejects a BUYER trying to register a vehicle", async () => {
      currentUser.role = "BUYER";

      const res = await request(app)
        .post("/api/vehicles")
        .set("Authorization", authHeader)
        .send({ registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/vehicles/bulk (Step 11 — fleet onboarding)", () => {
    it("registers a company's whole batch of trucks in one request", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile({ businessName: "ABC Logistics" }));
      mockVehiclesRepo.createMany.mockResolvedValue([
        makeVehicle({ id: "v1", publicId: "aaaaaaaa-1111-1111-1111-111111111111", registrationNumber: "MH12AB1234", normalizedRegistrationNumber: "MH12AB1234" }),
        makeVehicle({ id: "v2", publicId: "bbbbbbbb-2222-2222-2222-222222222222", registrationNumber: "MH12CD5678", normalizedRegistrationNumber: "MH12CD5678" }),
      ]);

      const res = await request(app)
        .post("/api/vehicles/bulk")
        .set("Authorization", authHeader)
        .send({
          vehicles: [
            { registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" },
            { registrationNumber: "MH12CD5678", vehicleType: "MINI_TRUCK", capacityValue: 1000, capacityUnit: "KG" },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.vehicles).toHaveLength(2);
    });

    it("rejects the whole batch with 409 when a plate repeats within it", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());

      const res = await request(app)
        .post("/api/vehicles/bulk")
        .set("Authorization", authHeader)
        .send({
          vehicles: [
            { registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" },
            { registrationNumber: "mh-12-ab-1234", vehicleType: "MINI_TRUCK", capacityValue: 1000, capacityUnit: "KG" },
          ],
        });

      expect(res.status).toBe(409);
      expect(mockVehiclesRepo.createMany).not.toHaveBeenCalled();
    });

    it("rejects an empty batch with 400 (schema-level validation)", async () => {
      const res = await request(app)
        .post("/api/vehicles/bulk")
        .set("Authorization", authHeader)
        .send({ vehicles: [] });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/vehicles/:publicId — ownership", () => {
    it("404s for a vehicle owned by a different transporter", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile({ id: "someone-elses-transporter" }));
      mockVehiclesRepo.findByPublicId.mockResolvedValue(makeVehicle({ transporterId: "transporter-1" }));

      const res = await request(app).get("/api/vehicles/22222222-2222-2222-2222-222222222222").set("Authorization", authHeader);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/vehicles/:publicId/availability", () => {
    it("updates availability to AVAILABLE", async () => {
      mockTransporters.findByUserId.mockResolvedValue(makeProfile());
      mockVehiclesRepo.findByPublicId.mockResolvedValue(makeVehicle());
      mockVehiclesRepo.updateAvailability.mockResolvedValue(makeVehicle({ availabilityStatus: "AVAILABLE" }));

      const res = await request(app)
        .patch("/api/vehicles/22222222-2222-2222-2222-222222222222/availability")
        .set("Authorization", authHeader)
        .send({ availabilityStatus: "AVAILABLE" });

      expect(res.status).toBe(200);
      expect(res.body.data.availabilityStatus).toBe("AVAILABLE");
    });

    it("rejects RESERVED at the schema layer with 400", async () => {
      const res = await request(app)
        .patch("/api/vehicles/22222222-2222-2222-2222-222222222222/availability")
        .set("Authorization", authHeader)
        .send({ availabilityStatus: "RESERVED" });

      expect(res.status).toBe(400);
      expect(mockVehiclesRepo.updateAvailability).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/transporters — discovery", () => {
    it("paginates results", async () => {
      mockTransporters.search.mockResolvedValue({ items: [makeProfile()], total: 1 });

      const res = await request(app)
        .get("/api/transporters?page=1&limit=20")
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it("applies the verified filter", async () => {
      await request(app).get("/api/transporters?verified=true").set("Authorization", authHeader);
      expect(mockTransporters.search).toHaveBeenCalledWith(expect.objectContaining({ verificationStatus: "VERIFIED" }));
    });

    it("applies the minimumCapacity filter", async () => {
      mockVehiclesRepo.discover.mockResolvedValue(["transporter-1"]);
      await request(app)
        .get("/api/transporters?minimumCapacity=3000&minimumCapacityUnit=KG")
        .set("Authorization", authHeader);

      expect(mockVehiclesRepo.discover).toHaveBeenCalledWith(expect.objectContaining({ minimumCapacityKg: 3000 }));
    });

    it("applies the state/district filter", async () => {
      await request(app)
        .get("/api/transporters?state=Maharashtra&district=Pune")
        .set("Authorization", authHeader);

      expect(mockTransporters.search).toHaveBeenCalledWith(
        expect.objectContaining({ state: "Maharashtra", district: "Pune" }),
      );
    });
  });

  describe("Admin verification", () => {
    it("rejects a non-admin", async () => {
      const res = await request(app)
        .patch("/api/admin/transporters/11111111-1111-1111-1111-111111111111/verification")
        .set("Authorization", authHeader)
        .send({ status: "VERIFIED" });

      expect(res.status).toBe(403);
    });

    it("allows an admin to verify a transporter", async () => {
      currentUser.role = "ADMIN";
      mockTransporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "PENDING" }));
      mockTransporters.updateVerificationStatus.mockResolvedValue(makeProfile({ verificationStatus: "VERIFIED" }));

      const res = await request(app)
        .patch("/api/admin/transporters/11111111-1111-1111-1111-111111111111/verification")
        .set("Authorization", authHeader)
        .send({ status: "VERIFIED" });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe("VERIFIED");
    });

    it("allows an admin to suspend a transporter, and rejects an invalid transition", async () => {
      currentUser.role = "ADMIN";
      mockTransporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "PENDING" }));

      const res = await request(app)
        .patch("/api/admin/transporters/11111111-1111-1111-1111-111111111111/verification")
        .set("Authorization", authHeader)
        .send({ status: "SUSPENDED" });

      expect(res.status).toBe(409);
    });

    it("allows an admin to verify a vehicle", async () => {
      currentUser.role = "ADMIN";
      mockVehiclesRepo.findByPublicId.mockResolvedValue(makeVehicle({ verificationStatus: "PENDING" }));
      mockVehiclesRepo.updateVerification.mockResolvedValue(makeVehicle({ verificationStatus: "VERIFIED" }));

      const res = await request(app)
        .patch("/api/admin/vehicles/22222222-2222-2222-2222-222222222222/verification")
        .set("Authorization", authHeader)
        .send({ status: "VERIFIED" });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe("VERIFIED");
    });
  });
});
