import request from "supertest";
import express from "express";

// Mock verifyAccessToken before importing anything that uses it
jest.mock("../../src/modules/auth/auth.utils", () => ({
  ...jest.requireActual("../../src/modules/auth/auth.utils"),
  verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }),
}));

import { createSellStoreRouter } from "../../src/modules/sell-vs-store/sell-vs-store.routes";
import { NotFoundError } from "../../src/common/errors";
import { errorHandler } from "../../src/middleware/errorHandler";

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
      ensure: jest.fn().mockResolvedValue({ id: "farmer-1" }),
    };
    mockAuthRepo = {
      // createAuthMiddleware calls repo.findUserById(payload.sub)
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

    // Use the project's actual error handler for proper AppError/ZodError mapping
    app.use(errorHandler);
  });

  const authHeader = "Bearer fake-valid-token";

  describe("POST /lots/:lotPublicId/analyze", () => {
    const lotPublicId = "11111111-1111-1111-1111-111111111111";

    it("1. Authenticated farmer can analyze their own lot", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({
        id: "lot-1",
        ownerType: "FARMER",
        farmerId: "farmer-1",
      });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const decision = {
        publicId: "dec-1",
        result: "SELL_NOW",
        status: "COMPLETED",
        confidenceScore: 0.85,
      };
      mockOrchestrator.generateDecision.mockResolvedValue(decision);

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.result).toBe("SELL_NOW");
      expect(mockLotAuth.canViewLot).toHaveBeenCalled();
      expect(mockOrchestrator.generateDecision).toHaveBeenCalledWith(lotPublicId, "user-1");
    });

    it("2. Unauthorized user cannot analyze another user's lot", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({
        id: "lot-1",
        ownerType: "FARMER",
        farmerId: "other-farmer",
      });
      mockLotAuth.canViewLot.mockResolvedValue(false);

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404); // Obfuscated as NotFound
      expect(mockOrchestrator.generateDecision).not.toHaveBeenCalled();
    });

    it("3. Missing lot returns 404", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404);
      expect(mockOrchestrator.generateDecision).not.toHaveBeenCalled();
    });

    it("4. Successful SELL_NOW response", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.generateDecision.mockResolvedValue({
        publicId: "dec-sell",
        result: "SELL_NOW",
        status: "COMPLETED",
        confidenceScore: 0.9,
        decisionMetadata: { engineVersion: "v1", sellScore: 80, storeScore: 20 },
      });

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.result).toBe("SELL_NOW");
    });

    it("5. Successful STORE response", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.generateDecision.mockResolvedValue({
        publicId: "dec-store",
        result: "STORE",
        status: "COMPLETED",
        confidenceScore: 0.75,
      });

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.result).toBe("STORE");
    });

    it("6. Successful INSUFFICIENT_DATA response (200, not error)", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.generateDecision.mockResolvedValue({
        publicId: "dec-insuf",
        result: "INSUFFICIENT_DATA",
        status: "COMPLETED",
        confidenceScore: 0,
      });

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/${lotPublicId}/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.result).toBe("INSUFFICIENT_DATA");
    });

    it("7. Invalid lotPublicId format returns validation error", async () => {
      const res = await request(app)
        .post("/api/sell-vs-store/lots/not-a-uuid/analyze")
        .set("Authorization", authHeader);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe("GET /lots/:lotPublicId/history", () => {
    const lotPublicId = "22222222-2222-2222-2222-222222222222";

    it("8. Returns decision history for an authorized lot", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const history = [
        { publicId: "dec-1", result: "SELL_NOW", createdAt: new Date().toISOString() },
        { publicId: "dec-2", result: "STORE", createdAt: new Date().toISOString() },
      ];
      mockOrchestrator.getDecisionsForLot.mockResolvedValue(history);

      const res = await request(app)
        .get(`/api/sell-vs-store/lots/${lotPublicId}/history`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(mockOrchestrator.getDecisionsForLot).toHaveBeenCalledWith(lotPublicId);
    });

    it("9. Decision retrieval does not recompute analytics", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);
      mockOrchestrator.getDecisionsForLot.mockResolvedValue([]);

      await request(app)
        .get(`/api/sell-vs-store/lots/${lotPublicId}/history`)
        .set("Authorization", authHeader);

      // generateDecision should NOT be called for history retrieval
      expect(mockOrchestrator.generateDecision).not.toHaveBeenCalled();
    });

    it("10. Unauthorized user cannot view lot history", async () => {
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(false);

      const res = await request(app)
        .get(`/api/sell-vs-store/lots/${lotPublicId}/history`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404); // Obfuscated
    });
  });

  describe("GET /decisions/:publicId", () => {
    const decisionPublicId = "33333333-3333-3333-3333-333333333333";

    it("11. Returns historical decision for authorized lot", async () => {
      mockOrchestrator.getDecisionByPublicId.mockResolvedValue({
        publicId: decisionPublicId,
        lotId: "lot-123",
        result: "STORE",
        confidenceScore: 0.85,
        inputSnapshot: { market: { trend: "UP" } },
      });
      mockLotsRepo.findById.mockResolvedValue({ id: "lot-123", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true);

      const res = await request(app)
        .get(`/api/sell-vs-store/decisions/${decisionPublicId}`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.publicId).toBe(decisionPublicId);
      expect(res.body.data.inputSnapshot).toBeDefined();
      expect(mockLotAuth.canViewLot).toHaveBeenCalled();
    });

    it("12. User cannot retrieve another user's decision by publicId", async () => {
      mockOrchestrator.getDecisionByPublicId.mockResolvedValue({
        publicId: decisionPublicId,
        lotId: "lot-123",
      });
      mockLotsRepo.findById.mockResolvedValue({ id: "lot-123", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(false);

      const res = await request(app)
        .get(`/api/sell-vs-store/decisions/${decisionPublicId}`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404); // Obfuscated
    });

    it("13. Missing decision returns 404", async () => {
      mockOrchestrator.getDecisionByPublicId.mockRejectedValue(
        new NotFoundError("Decision not found.")
      );

      const res = await request(app)
        .get(`/api/sell-vs-store/decisions/${decisionPublicId}`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(404);
    });

    it("14. Invalid publicId format returns validation error", async () => {
      const res = await request(app)
        .get("/api/sell-vs-store/decisions/not-a-uuid")
        .set("Authorization", authHeader);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe("ADMIN authorization", () => {
    it("15. Admin can analyze any lot", async () => {
      // Override the auth repo mock to return an admin user
      mockAuthRepo.findUserById.mockResolvedValue({
        id: "admin-1",
        publicId: "pub-admin-1",
        role: "ADMIN",
        accountStatus: "ACTIVE",
      });
      mockLotsRepo.findByPublicId.mockResolvedValue({ id: "lot-1", ownerType: "FARMER" });
      mockLotAuth.canViewLot.mockResolvedValue(true); // ADMIN always returns true
      mockOrchestrator.generateDecision.mockResolvedValue({
        publicId: "dec-admin",
        result: "SELL_NOW",
        status: "COMPLETED",
      });

      const res = await request(app)
        .post(`/api/sell-vs-store/lots/11111111-1111-1111-1111-111111111111/analyze`)
        .set("Authorization", authHeader);

      expect(res.status).toBe(200);
    });
  });
});
