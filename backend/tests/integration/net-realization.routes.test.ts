import request from "supertest";
import express from "express";

jest.mock("../../src/modules/auth/auth.utils", () => ({
  ...jest.requireActual("../../src/modules/auth/auth.utils"),
  verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }),
}));

import { createNetRealizationRouter } from "../../src/modules/net-realization/net-realization.routes";
import { NotFoundError } from "../../src/common/errors";
import { errorHandler } from "../../src/middleware/errorHandler";

describe("Net Realization Routes Integration", () => {
  let app: express.Express;
  let mockOrchestrator: any;
  let mockLotsRepo: any;
  let mockLotAuth: any;
  let mockFarmersResolver: any;
  let mockAuthRepo: any;
  let mockAuditService: any;

  beforeEach(() => {
    mockOrchestrator = {
      calculate: jest.fn(),
      getByPublicId: jest.fn(),
      listForLot: jest.fn(),
    };
    mockLotsRepo = {
      findByPublicId: jest.fn(),
      findById: jest.fn(),
    };
    mockLotAuth = {
      canViewLot: jest.fn(),
    };
    mockFarmersResolver = {
      ensure: jest.fn().mockResolvedValue({ id: "farmer-1" }),
    };
    mockAuthRepo = {
      findUserById: jest.fn().mockResolvedValue({
        id: "user-1",
        publicId: "pub-user-1",
        role: "FARMER",
        accountStatus: "ACTIVE",
      }),
    };
    mockAuditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const router = createNetRealizationRouter(
      mockOrchestrator,
      mockLotsRepo,
      mockLotAuth,
      mockFarmersResolver,
      mockAuthRepo,
      mockAuditService,
    );

    app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use(errorHandler);
  });

  const authHeader = "Bearer fake-valid-token";
  const lotPublicId = "11111111-1111-1111-1111-111111111111";
  const calcPublicId = "22222222-2222-2222-2222-222222222222";

  describe("POST /api/net-realization/lots/:lotPublicId/calculate", () => {
    it("authenticated farmer can calculate realization for their own lot", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER", farmerId: "farmer-1" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.calculate.mockResolvedValue({
        publicId: "calc-1",
        status: "COMPLETED",
        result: { netRealization: 19500, completeness: "COMPLETE" },
      });

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(mockOrchestrator.calculate).toHaveBeenCalledWith(lotPublicId, {}, { id: "user-1", role: "FARMER" });
    });

    it("unauthorized user cannot calculate for another user's lot (obfuscated 404)", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER", farmerId: "other-farmer" });
      mockLotAuth.canViewLot.mockResolvedValue(false);

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(404);
      expect(mockOrchestrator.calculate).not.toHaveBeenCalled();
    });

    it("missing lot returns 404", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(404);
    });

    it("returns 200 for an INSUFFICIENT_DATA result — a valid outcome, not an error", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.calculate.mockResolvedValue({
        publicId: "calc-2",
        status: "INSUFFICIENT_DATA",
        result: { netRealization: null, completeness: "INSUFFICIENT" },
      });

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.result.netRealization).toBeNull();
    });

    it("invalid lotPublicId format returns a validation error", async () => {
      const res = await request(app)
        .post("/api/net-realization/lots/not-a-uuid/calculate")
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(mockOrchestrator.calculate).not.toHaveBeenCalled();
    });

    it("rejects a negative sale price at the request-validation layer", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({ salePricePerUnit: -100 });

      expect(res.status).toBe(400);
      expect(mockOrchestrator.calculate).not.toHaveBeenCalled();
    });

    it("rejects a negative cost amount at the request-validation layer", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({ costs: [{ category: "TRANSPORT", amount: -50 }] });

      expect(res.status).toBe(400);
      expect(mockOrchestrator.calculate).not.toHaveBeenCalled();
    });

    it("rejects an OTHER cost with no name", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({ costs: [{ category: "OTHER", amount: 10 }] });

      expect(res.status).toBe(400);
    });

    it("rejects an unknown top-level field (strict schema)", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({ role: "ADMIN" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/net-realization/:publicId", () => {
    it("returns a historical calculation for an authorized lot", async () => {
      mockOrchestrator.getByPublicId.mockResolvedValue({
        publicId: calcPublicId,
        lotId: "lot-123",
        status: "COMPLETED",
      });
      mockLotsRepo.findById.mockResolvedValue({ id: "lot-123", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const res = await request(app).get(`/api/net-realization/${calcPublicId}`).set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.publicId).toBe(calcPublicId);
    });

    it("obfuscates another user's calculation as not found", async () => {
      mockOrchestrator.getByPublicId.mockResolvedValue({ publicId: calcPublicId, lotId: "lot-123" });
      mockLotsRepo.findById.mockResolvedValue({ id: "lot-123", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(false);

      const res = await request(app).get(`/api/net-realization/${calcPublicId}`).set("Authorization", authHeader);

      expect(res.status).toBe(404);
    });

    it("missing calculation returns 404", async () => {
      mockOrchestrator.getByPublicId.mockRejectedValue(new NotFoundError("Calculation not found."));

      const res = await request(app).get(`/api/net-realization/${calcPublicId}`).set("Authorization", authHeader);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/lots/:lotPublicId/net-realizations", () => {
    it("returns a paginated list for an authorized lot", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.listForLot.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

      const res = await request(app)
        .get(`/api/lots/${lotPublicId}/net-realizations`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(mockOrchestrator.listForLot).toHaveBeenCalledWith(lotPublicId, 1, 20);
    });

    it("clamps an out-of-range pageSize query param via the schema default/max", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.listForLot.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });

      const res = await request(app)
        .get(`/api/lots/${lotPublicId}/net-realizations?pageSize=9999`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(400); // exceeds schema max(100) -> validation error
    });
  });

  describe("ROLE-based access control", () => {
    it("a BUYER account cannot reach the calculate endpoint (403), no lot lookup happens", async () => {
      mockAuthRepo.findUserById.mockResolvedValue({
        id: "buyer-1",
        publicId: "pub-buyer-1",
        role: "BUYER",
        accountStatus: "ACTIVE",
      });

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(403);
      expect(mockLotsRepo.findByPublicId).not.toHaveBeenCalled();
      expect(mockOrchestrator.calculate).not.toHaveBeenCalled();
    });

    it("an ADMIN can calculate for any lot", async () => {
      mockAuthRepo.findUserById.mockResolvedValue({
        id: "admin-1",
        publicId: "pub-admin-1",
        role: "ADMIN",
        accountStatus: "ACTIVE",
      });
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.calculate.mockResolvedValue({ publicId: "calc-3", status: "COMPLETED" });

      const res = await request(app)
        .post(`/api/net-realization/lots/${lotPublicId}/calculate`)
        .set("Authorization", authHeader)
        .send({});

      expect(res.status).toBe(200);
    });
  });
});
