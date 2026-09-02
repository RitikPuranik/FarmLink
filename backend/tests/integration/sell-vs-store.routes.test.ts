import request from "supertest";
import express from "express";

jest.mock("../../src/modules/auth/auth.utils", () => ({
  verifyAccessToken: jest.fn().mockReturnValue({ userId: "user-1", role: "FARMER" }),
}));

import { createSellStoreRouter } from "../../src/modules/sell-vs-store/sell-vs-store.routes";

describe("Sell vs Store Routes Integration", () => {
  let app: express.Express;
  let mockOrchestrator: any;
  let mockLotsRepo: any;
  let mockLotAuth: any;
  let mockFarmersResolver: any;
  let mockAuthRepo: any;
  let mockAuditService: any;

  beforeEach(() => {
    mockOrchestrator = {
      generateDecision: jest.fn(),
      getDecisionsForLot: jest.fn(),
      getDecisionByPublicId: jest.fn(),
    };
    mockLotsRepo = {
      findByPublicId: jest.fn(),
      findById: jest.fn(),
    };
    mockLotAuth = {
      canViewLot: jest.fn(),
    };
    mockFarmersResolver = {
      ensure: jest.fn(),
    };
    mockAuthRepo = {
      findByToken: jest.fn(),
    };
    mockAuditService = {
      record: jest.fn(),
    };

    const router = createSellStoreRouter(
      mockOrchestrator,
      mockLotsRepo,
      mockLotAuth,
      mockFarmersResolver,
      mockAuthRepo,
      mockAuditService
    );

    app = express();
    app.use(express.json());
    app.use("/api/sell-vs-store", router);

    // Error handler for proper formatting
    app.use((err: any, req: any, res: any, next: any) => {
      res.status(err.statusCode || 500).json({
        success: false,
        error: {
          code: err.code || "INTERNAL_ERROR",
          message: err.message,
        },
      });
    });
  });

  const validToken = "valid-token";
  const authHeader = `Bearer ${validToken}`;

  const setupAuth = (role: string = "FARMER") => {
    mockAuthRepo.findByToken.mockResolvedValue({
      id: "user-1",
      userId: "user-1",
      role,
      status: "ACTIVE",
    });
    mockFarmersResolver.ensure.mockResolvedValue({ id: "farmer-1" });
  };

  describe("POST /lots/:lotPublicId/analyze", () => {
    const lotPublicId = "11111111-1111-1111-1111-111111111111";

    it("should successfully analyze an authorized lot", async () => {
      setupAuth();
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const decision = { publicId: "dec-1", result: "SELL_NOW", status: "COMPLETED" };
      mockOrchestrator.generateDecision.mockResolvedValue(decision);

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(decision);
      expect(mockLotAuth.canViewLot).toHaveBeenCalled();
      expect(mockOrchestrator.generateDecision).toHaveBeenCalledWith(lotPublicId, "user-1");
    });

    it("should return 404 (obfuscated) if user is not authorized to view the lot", async () => {
      setupAuth();
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(false); // Unauthorized

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404);
      expect(mockOrchestrator.generateDecision).not.toHaveBeenCalled();
    });

    it("should return 404 if lot does not exist", async () => {
      setupAuth();
      mockLotsRepo.findByPublicId.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404);
      expect(mockOrchestrator.generateDecision).not.toHaveBeenCalled();
    });

    it("should return successful 200 even if INSUFFICIENT_DATA", async () => {
      setupAuth();
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const decision = { publicId: "dec-2", result: "INSUFFICIENT_DATA", status: "COMPLETED" };
      mockOrchestrator.generateDecision.mockResolvedValue(decision);

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.result).toBe("INSUFFICIENT_DATA");
    });
  });

  describe("GET /lots/:lotPublicId/history", () => {
    const lotPublicId = "22222222-2222-2222-2222-222222222222";

    it("should return history for authorized lot", async () => {
      setupAuth();
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      
      const history = [{ publicId: "dec-1" }, { publicId: "dec-2" }];
      mockOrchestrator.getDecisionsForLot.mockResolvedValue(history);

      const res = await request(app)
        .get(`/api/sell-vs-store/lots/${lotPublicId}/history`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(mockOrchestrator.getDecisionsForLot).toHaveBeenCalledWith(lotPublicId);
    });

    it("should reject unauthorized access to history", async () => {
      setupAuth();
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1" });
      mockLotAuth.canViewLot.mockResolvedValue(false); // Unauthorized

      const res = await request(app)
        .get(`/api/sell-vs-store/lots/${lotPublicId}/history`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404); // Obfuscated
    });
  });

  describe("GET /decisions/:publicId", () => {
    const decisionPublicId = "33333333-3333-3333-3333-333333333333";

    it("should return historical decision if authorized for the associated lot", async () => {
      setupAuth();
      mockOrchestrator.getDecisionByPublicId.mockResolvedValue({
        publicId: decisionPublicId,
        lotId: "lot-123"
      });
      mockLotsRepo.findById.mockResolvedValue({ id: "lot-123" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const res = await request(app)
        .get(`/api/sell-vs-store/decisions/${decisionPublicId}`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.publicId).toBe(decisionPublicId);
      expect(mockLotAuth.canViewLot).toHaveBeenCalled();
    });

    it("should return 404 (obfuscated) if trying to fetch decision for unauthorized lot", async () => {
      setupAuth();
      mockOrchestrator.getDecisionByPublicId.mockResolvedValue({
        publicId: decisionPublicId,
        lotId: "lot-123"
      });
      mockLotsRepo.findById.mockResolvedValue({ id: "lot-123" });
      mockLotAuth.canViewLot.mockResolvedValue(false); // Unauthorized

      const res = await request(app)
        .get(`/api/sell-vs-store/decisions/${decisionPublicId}`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404);
    });
  });
});
