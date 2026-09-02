/**
 * Module 7 — concurrency & authorization integration tests.
 *
 * These run against a REAL PostgreSQL database through the generated
 * Prisma Client (not the in-memory fakes used by Modules 1-5's tests),
 * because the behavior under test — atomic conditional updates racing
 * inside real database transactions — cannot be exercised meaningfully
 * against an in-memory stand-in. See prisma/README-engines.md: this
 * requires `npm install && npx prisma generate` on a machine with normal
 * internet access before `DATABASE_URL` (pointing at a disposable test
 * database) will let these run. They could not be executed inside the
 * sandboxed audit environment for the same reason documented there
 * (binaries.prisma.sh unreachable) — the equivalent SQL pattern was
 * instead verified directly against a real Postgres server with the
 * plain `pg` driver; see the audit report for that evidence.
 *
 * Run with: DATABASE_URL=... npm run test:db
 * (excluded from the default `npm test` run — see jest.config.js)
 */
import { PrismaClient } from "@prisma/client";
import { BuyerMatchingService } from "../../src/modules/buyer-matching/buyer-matching.service";
import { PrismaCropLotRepository } from "../../src/modules/lots/lots.repository";
import { LotAuthorizationService } from "../../src/modules/lots/lot.authorization";
import { FpoAuthorizationService } from "../../src/modules/fpo/fpo.authorization";
import { PrismaFpoAdminRepository } from "../../src/modules/fpo/fpo-admin.repository";
import { FarmerProfileResolver } from "../../src/modules/farmers/farmer-profile.resolver";
import { PrismaFarmerProfileRepository } from "../../src/modules/farmers/farmer-profile.repository";
import { FakeAuditService } from "../testUtils/fakeAuditService";

const prisma = new PrismaClient();
const audit = new FakeAuditService();
// Real, production-equivalent wiring (matches src/server.ts's construction),
// not the in-memory fakes Modules 1-5's tests use — see file header.
const lots = new PrismaCropLotRepository(prisma);
const lotAuth = new LotAuthorizationService(new FpoAuthorizationService(new PrismaFpoAdminRepository(prisma)));
const farmers = new FarmerProfileResolver(new PrismaFarmerProfileRepository(prisma));
const service = new BuyerMatchingService(prisma, lots, lotAuth, farmers, audit);

async function seedActor(role: "FARMER" | "BUYER", mobileSuffix: string) {
  const user = await prisma.user.create({
    data: {
      fullName: `${role} Test ${mobileSuffix}`,
      mobile: `9${mobileSuffix.padStart(9, "0")}`,
      passwordHash: "test-hash",
      role,
      accountStatus: "ACTIVE",
    },
  });
  return user;
}

async function seedFixtures() {
  const crop = await prisma.crop.create({ data: { name: `TestCrop-${Date.now()}-${Math.random()}` } });

  const farmerUser = await seedActor("FARMER", String(Math.floor(Math.random() * 1e8)));
  const farmerProfile = await prisma.farmerProfile.create({ data: { userId: farmerUser.id } });

  const buyerUser = await seedActor("BUYER", String(Math.floor(Math.random() * 1e8)));
  const buyer = await prisma.buyerProfile.create({
    data: {
      userId: buyerUser.id,
      organizationName: "Test Buyer Co",
      businessType: "WHOLESALER",
      contactPerson: "Test Contact",
      phone: "9999999999",
      state: "Madhya Pradesh",
      district: "Ujjain",
      verificationStatus: "VERIFIED",
    },
  });

  const lot = await prisma.cropLot.create({
    data: {
      lotNumber: `LOT-TEST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      ownerType: "FARMER",
      sourceType: "FARMER_CREATED",
      farmerId: farmerProfile.id,
      cropId: crop.id,
      unit: "KG",
      quantityKg: "1000",
      availableQuantityKg: "1000",
      availabilityDate: new Date(),
      originDistrict: "Ujjain",
      originState: "Madhya Pradesh",
    },
  });

  const demand = await prisma.buyerDemand.create({
    data: {
      buyerId: buyer.id,
      cropId: crop.id,
      title: "Test demand",
      state: "Madhya Pradesh",
      district: "Ujjain",
      requiredQuantity: "100",
      committedQuantity: "0",
      quantityUnit: "KG",
      status: "ACTIVE",
    },
  });

  return { farmerUser, buyerUser, buyer, lot, demand, crop };
}

async function seedOffer(lotId: string, demandId: string, initiatorId: string, quantity: string, status: "SENT" | "COUNTERED" = "SENT") {
  return prisma.tradeOffer.create({
    data: {
      lotId,
      buyerDemandId: demandId,
      initiatorId,
      quantity,
      quantityUnit: "KG",
      offeredPrice: "2000",
      totalValue: (Number(quantity) * 2000).toString(),
      status,
    },
  });
}

// Builds a full AuthenticatedUserContext ({ id, publicId, role }) from a
// seeded User row, matching src/modules/auth/auth.types.ts exactly.
function ctx(user: { id: string; publicId: string; role: string }) {
  return { id: user.id, publicId: user.publicId, role: user.role as any };
}

describe("BuyerMatchingService — concurrent offer acceptance (§7.12 / §7.13)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("never overcommits a demand when two offers (70 + 60) race against capacity 100", async () => {
    const { farmerUser, buyerUser, lot, demand } = await seedFixtures();
    const offerA = await seedOffer(lot.id, demand.id, farmerUser.id, "70");
    const offerB = await seedOffer(lot.id, demand.id, farmerUser.id, "60");

    const buyerContext = ctx(buyerUser);
    const results = await Promise.allSettled([
      service.accept(buyerContext, offerA.publicId),
      service.accept(buyerContext, offerB.publicId),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBe(1); // exactly one of the two must win

    const finalDemand = await prisma.buyerDemand.findUniqueOrThrow({ where: { id: demand.id } });
    expect(Number(finalDemand.committedQuantity)).toBeLessThanOrEqual(100);
    expect(Number(finalDemand.committedQuantity)).toBe(succeeded.length === 1 ? Number((succeeded[0] as any).value.quantity) : 0);
  });

  it("never oversells a lot when two accepted offers' combined quantity exceeds available stock", async () => {
    const { farmerUser, buyerUser, lot } = await seedFixtures();
    // Small lot, two independent (large) demands so the demand-side check
    // doesn't also become the limiting factor — isolates the lot race.
    await prisma.cropLot.update({ where: { id: lot.id }, data: { availableQuantityKg: "100" } });
    const secondBuyerUser = await seedActor("BUYER", String(Math.floor(Math.random() * 1e8)));
    const buyer2 = await prisma.buyerProfile.create({
      data: {
        userId: secondBuyerUser.id,
        organizationName: "Second Buyer", businessType: "TRADER", contactPerson: "X", phone: "9888888888",
        state: "Madhya Pradesh", district: "Ujjain", verificationStatus: "VERIFIED",
      },
    });
    const demand2 = await prisma.buyerDemand.create({ data: { buyerId: buyer2.id, cropId: lot.cropId, title: "Second demand", state: "Madhya Pradesh", district: "Ujjain", requiredQuantity: "1000", quantityUnit: "KG", status: "ACTIVE" } });
    const [demandForA] = await prisma.buyerDemand.findMany({ where: { cropId: lot.cropId }, take: 1 });

    const offerA = await seedOffer(lot.id, demandForA.id, farmerUser.id, "70");
    const offerB = await seedOffer(lot.id, demand2.id, farmerUser.id, "60");

    const results = await Promise.allSettled([
      service.accept(ctx(buyerUser), offerA.publicId),
      service.accept(ctx(secondBuyerUser), offerB.publicId),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBe(1);

    const finalLot = await prisma.cropLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(Number(finalLot.availableQuantityKg)).toBeGreaterThanOrEqual(0);
  });

  it("marks the demand FULFILLED exactly when committed quantity reaches required quantity", async () => {
    const { farmerUser, buyerUser, lot, demand } = await seedFixtures();
    const offerA = await seedOffer(lot.id, demand.id, farmerUser.id, "70");
    const offerC = await seedOffer(lot.id, demand.id, farmerUser.id, "30");
    const buyerContext = ctx(buyerUser);
    await service.accept(buyerContext, offerA.publicId);
    await service.accept(buyerContext, offerC.publicId);
    const finalDemand = await prisma.buyerDemand.findUniqueOrThrow({ where: { id: demand.id } });
    expect(finalDemand.status).toBe("FULFILLED");
    expect(Number(finalDemand.committedQuantity)).toBe(100);
  });

  it("rolls back the whole transaction (offer stays claimable) when the demand-side check fails", async () => {
    const { farmerUser, buyerUser, lot, demand } = await seedFixtures();
    await prisma.buyerDemand.update({ where: { id: demand.id }, data: { committedQuantity: "100" } }); // already full
    const offer = await seedOffer(lot.id, demand.id, farmerUser.id, "10");
    await expect(service.accept(ctx(buyerUser), offer.publicId)).rejects.toThrow();
    const finalLot = await prisma.cropLot.findUniqueOrThrow({ where: { id: lot.id } });
    const finalOffer = await prisma.tradeOffer.findUniqueOrThrow({ where: { id: offer.id } });
    // Lot quantity must be untouched — the whole transaction rolled back,
    // not just the demand step.
    expect(Number(finalLot.availableQuantityKg)).toBe(1000);
    expect(finalOffer.status).toBe("SENT");
  });

  it("rejects acceptance of an expired offer instead of silently succeeding", async () => {
    const { farmerUser, buyerUser, lot, demand } = await seedFixtures();
    const offer = await seedOffer(lot.id, demand.id, farmerUser.id, "10");
    await prisma.tradeOffer.update({ where: { id: offer.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(service.accept(ctx(buyerUser), offer.publicId)).rejects.toThrow(/expired/i);
  });

  it("a reject/withdraw racing a concurrent accept never silently loses committed quantity", async () => {
    // Regression test for the exact TOCTOU bug found in offerAction(): the
    // old blind update() could flip an ACCEPTED offer to REJECTED without
    // releasing the committed quantity. See race2.js for the raw-SQL proof.
    const { farmerUser, buyerUser, lot, demand } = await seedFixtures();
    const offer = await seedOffer(lot.id, demand.id, farmerUser.id, "70");
    const buyerContext = ctx(buyerUser);
    const farmerContext = ctx(farmerUser);

    await Promise.allSettled([
      service.accept(buyerContext, offer.publicId),
      service.offerAction(farmerContext, offer.publicId, "WITHDRAWN"),
    ]);

    const finalOffer = await prisma.tradeOffer.findUniqueOrThrow({ where: { id: offer.id } });
    const finalDemand = await prisma.buyerDemand.findUniqueOrThrow({ where: { id: demand.id } });
    // The two outcomes must agree: ACCEPTED+committed, or WITHDRAWN+uncommitted.
    // Never REJECTED/WITHDRAWN with quantity still committed.
    if (finalOffer.status === "ACCEPTED") {
      expect(Number(finalDemand.committedQuantity)).toBe(70);
    } else {
      expect(finalOffer.status).toBe("WITHDRAWN");
      expect(Number(finalDemand.committedQuantity)).toBe(0);
    }
  });
});

describe("BuyerMatchingService — offer listing by role (§7.8)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("every valid role sees offers where they are a genuine participant, never an empty [] by default", async () => {
    const { farmerUser, buyerUser, lot, demand } = await seedFixtures();
    await seedOffer(lot.id, demand.id, farmerUser.id, "10");

    const farmerOffers = await service.offers(ctx(farmerUser));
    const buyerOffers = await service.offers(ctx(buyerUser));
    expect(farmerOffers.length).toBeGreaterThan(0);
    expect(buyerOffers.length).toBeGreaterThan(0);
  });

  it("ADMIN can fetch an individual buyer demand for moderation even though they don't own it", async () => {
    const { demand } = await seedFixtures();
    const adminUser = await seedActor("BUYER", String(Math.floor(Math.random() * 1e8))); // role reassigned below
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: "ADMIN" } });
    const result = await service.demand(ctx({ ...adminUser, role: "ADMIN" }), demand.publicId);
    expect(result.id).toBe(demand.id);
  });

  it("a non-owning BUYER cannot fetch another buyer's demand", async () => {
    const { demand } = await seedFixtures();
    const otherBuyerUser = await seedActor("BUYER", String(Math.floor(Math.random() * 1e8)));
    await prisma.buyerProfile.create({
      data: { userId: otherBuyerUser.id, organizationName: "Other Co", businessType: "RETAILER", contactPerson: "Y", phone: "9777777777", state: "MP", district: "Indore", verificationStatus: "VERIFIED" },
    });
    await expect(service.demand(ctx(otherBuyerUser), demand.publicId)).rejects.toThrow();
  });
});

describe("BuyerMatchingService — demand/offer expiry (§7.2 / §7.11)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("createOffer rejects an offer against a demand whose expiresAt has passed, even though status is still ACTIVE", async () => {
    const { farmerUser, lot, demand } = await seedFixtures();
    await prisma.buyerDemand.update({ where: { id: demand.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(
      service.createOffer(
        ctx(farmerUser),
        { lotPublicId: lot.publicId, buyerDemandPublicId: demand.publicId, quantity: 10, quantityUnit: "KG", offeredPrice: 2000 } as any,
      ),
    ).rejects.toThrow(/not active/i);
  });
});
