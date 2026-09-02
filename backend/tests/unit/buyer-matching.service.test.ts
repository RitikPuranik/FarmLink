/**
 * Unit tests for BuyerMatchingService domain logic:
 * - Fix 1: requiredQuantity below committedQuantity rejection
 * - Fix 2: lazy demand expiration
 *
 * Uses lightweight Prisma mocks — does not require a real database.
 */
import { Prisma } from "@prisma/client";
import { BuyerMatchingService } from "../../src/modules/buyer-matching/buyer-matching.service";
import { FakeAuditService } from "../testUtils/fakeAuditService";

function makeFakePrisma(overrides: Record<string, any> = {}) {
  return {
    buyerProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: "buyer-1", userId: "user-1", publicId: "bp-pub-1", organizationName: "Test", businessType: "WHOLESALER", verificationStatus: "VERIFIED" }),
    },
    buyerDemand: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    crop: {
      findUnique: jest.fn().mockResolvedValue({ id: "crop-1", name: "Wheat" }),
    },
    ...overrides,
  } as any;
}

const dummyLots = { findByPublicId: jest.fn() } as any;
const dummyLotAuth = { canModifyLot: jest.fn() } as any;
const dummyFarmers = { ensure: jest.fn() } as any;
const audit = new FakeAuditService();

function buyerCtx() {
  return { id: "user-1", publicId: "u-pub-1", role: "BUYER" as const };
}

describe("BuyerMatchingService — requiredQuantity vs committedQuantity (Fix 1)", () => {
  it("rejects updateDemand when new requiredQuantity < committedQuantity", async () => {
    const prisma = makeFakePrisma();
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "DRAFT",
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(80),
      minimumQuantity: null,
      minimumPrice: null,
      maximumPrice: null,
      latitude: null,
      longitude: null,
      deliveryStartDate: null,
      deliveryEndDate: null,
      expiresAt: null,
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    await expect(
      service.updateDemand(buyerCtx(), "d-pub-1", { requiredQuantity: 50 }),
    ).rejects.toThrow(/committedQuantity/i);
  });

  it("rejects with structured error code REQUIRED_QUANTITY_BELOW_COMMITTED", async () => {
    const prisma = makeFakePrisma();
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "PAUSED",
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(80),
      minimumQuantity: null,
      minimumPrice: null,
      maximumPrice: null,
      latitude: null,
      longitude: null,
      deliveryStartDate: null,
      deliveryEndDate: null,
      expiresAt: null,
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    try {
      await service.updateDemand(buyerCtx(), "d-pub-1", { requiredQuantity: 79 });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.code).toBe("REQUIRED_QUANTITY_BELOW_COMMITTED");
    }
  });

  it("allows requiredQuantity equal to committedQuantity (boundary)", async () => {
    const prisma = makeFakePrisma();
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "DRAFT",
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(80),
      minimumQuantity: null,
      minimumPrice: null,
      maximumPrice: null,
      latitude: null,
      longitude: null,
      deliveryStartDate: null,
      deliveryEndDate: null,
      expiresAt: null,
    });
    prisma.buyerDemand.update = jest.fn().mockResolvedValue({
      id: "d-1",
      requiredQuantity: new Prisma.Decimal(80),
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    // requiredQuantity = 80 equals committedQuantity = 80 → must be allowed
    await expect(
      service.updateDemand(buyerCtx(), "d-pub-1", { requiredQuantity: 80 }),
    ).resolves.toBeDefined();
  });

  it("allows requiredQuantity above committedQuantity", async () => {
    const prisma = makeFakePrisma();
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "DRAFT",
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(80),
      minimumQuantity: null,
      minimumPrice: null,
      maximumPrice: null,
      latitude: null,
      longitude: null,
      deliveryStartDate: null,
      deliveryEndDate: null,
      expiresAt: null,
    });
    prisma.buyerDemand.update = jest.fn().mockResolvedValue({
      id: "d-1",
      requiredQuantity: new Prisma.Decimal(120),
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    await expect(
      service.updateDemand(buyerCtx(), "d-pub-1", { requiredQuantity: 120 }),
    ).resolves.toBeDefined();
  });

  it("does not reject when requiredQuantity is not being updated", async () => {
    const prisma = makeFakePrisma();
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "DRAFT",
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(80),
      title: "Original",
      minimumQuantity: null,
      minimumPrice: null,
      maximumPrice: null,
      latitude: null,
      longitude: null,
      deliveryStartDate: null,
      deliveryEndDate: null,
      expiresAt: null,
    });
    prisma.buyerDemand.update = jest.fn().mockResolvedValue({
      id: "d-1",
      title: "Updated",
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    // Only updating title, not requiredQuantity — should pass even though committedQuantity is 80
    await expect(
      service.updateDemand(buyerCtx(), "d-pub-1", { title: "Updated" }),
    ).resolves.toBeDefined();
  });
});

describe("BuyerMatchingService — lazy demand expiration (Fix 2)", () => {
  it("transitions an expired ACTIVE demand to EXPIRED on read", async () => {
    const prisma = makeFakePrisma();
    const pastDate = new Date(Date.now() - 60_000);
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "ACTIVE",
      expiresAt: pastDate,
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(0),
    });
    prisma.buyerDemand.updateMany.mockResolvedValue({ count: 1 });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    const result = await service.demand(buyerCtx(), "d-pub-1");

    expect(result.status).toBe("EXPIRED");
    expect(prisma.buyerDemand.updateMany).toHaveBeenCalledWith({
      where: { id: "d-1", status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
  });

  it("does not expire a demand that is not ACTIVE even if past expiresAt", async () => {
    const prisma = makeFakePrisma();
    const pastDate = new Date(Date.now() - 60_000);
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "PAUSED",
      expiresAt: pastDate,
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(0),
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    const result = await service.demand(buyerCtx(), "d-pub-1");

    expect(result.status).toBe("PAUSED");
    expect(prisma.buyerDemand.updateMany).not.toHaveBeenCalled();
  });

  it("does not expire a demand with no expiresAt", async () => {
    const prisma = makeFakePrisma();
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "ACTIVE",
      expiresAt: null,
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(0),
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    const result = await service.demand(buyerCtx(), "d-pub-1");

    expect(result.status).toBe("ACTIVE");
    expect(prisma.buyerDemand.updateMany).not.toHaveBeenCalled();
  });

  it("does not expire a demand whose expiresAt is in the future", async () => {
    const prisma = makeFakePrisma();
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 600_000),
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(0),
    });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    const result = await service.demand(buyerCtx(), "d-pub-1");

    expect(result.status).toBe("ACTIVE");
    expect(prisma.buyerDemand.updateMany).not.toHaveBeenCalled();
  });

  it("handles concurrent expiration safely — updateMany returns 0 when another operation already transitioned the demand", async () => {
    const prisma = makeFakePrisma();
    const pastDate = new Date(Date.now() - 60_000);
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "ACTIVE",
      expiresAt: pastDate,
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(0),
    });
    // Simulate concurrent transition: updateMany matches 0 rows because
    // another request already moved the demand out of ACTIVE
    prisma.buyerDemand.updateMany.mockResolvedValue({ count: 0 });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    const result = await service.demand(buyerCtx(), "d-pub-1");

    // Status stays as read from DB (ACTIVE) because the conditional update
    // saw 0 rows — the caller's in-memory object reflects the DB snapshot.
    // On the next read the DB will have the real status.
    expect(result.status).toBe("ACTIVE");
  });

  it("expired demand blocks transitions (e.g. cannot activate an expired demand)", async () => {
    const prisma = makeFakePrisma();
    const pastDate = new Date(Date.now() - 60_000);
    prisma.buyerDemand.findUnique.mockResolvedValue({
      id: "d-1",
      publicId: "d-pub-1",
      buyerId: "buyer-1",
      status: "ACTIVE",
      expiresAt: pastDate,
      requiredQuantity: new Prisma.Decimal(100),
      committedQuantity: new Prisma.Decimal(0),
    });
    prisma.buyerDemand.updateMany.mockResolvedValue({ count: 1 });

    const service = new BuyerMatchingService(prisma, dummyLots, dummyLotAuth, dummyFarmers, audit);
    // transitionDemand calls demand() first, which lazily expires it.
    // Then it tries requireTransition(EXPIRED -> ACTIVE) which should fail.
    await expect(
      service.transitionDemand(buyerCtx(), "d-pub-1", "ACTIVE"),
    ).rejects.toThrow(/INVALID_DEMAND_TRANSITION/);
  });
});
