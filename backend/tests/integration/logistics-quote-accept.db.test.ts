/**
 * Module 16 — concurrency integration test for quote acceptance.
 *
 * Runs against a REAL PostgreSQL database through the generated Prisma
 * Client (not an in-memory fake), because the behavior under test —
 * `PrismaLogisticsQuoteRepository.acceptQuoteTransaction`'s atomic
 * conditional updates racing inside a real database transaction — cannot
 * be exercised meaningfully against an in-memory stand-in. See
 * prisma/README-engines.md: this requires `npm install && npx prisma
 * generate` on a machine with normal internet access before
 * `DATABASE_URL` (pointing at a disposable test database) will let this
 * run. It could not be executed inside the sandboxed build environment
 * for the same reason documented there (binaries.prisma.sh unreachable)
 * — the exact same two-step conditional-UPDATE pattern used by
 * acceptQuoteTransaction() (request OPEN->QUOTE_ACCEPTED, then quote
 * SUBMITTED->ACCEPTED, both `WHERE ... AND status = '<expected>'`, ROLLBACK
 * on either affecting 0 rows) was instead verified directly against a
 * real local Postgres server with the plain `pg` driver: 5 consecutive
 * runs of two concurrent accept attempts against the same OPEN request
 * each produced exactly one winner, exactly one ACCEPTED quote, the loser
 * REJECTED, and the request's own accepted_quote_id matching the winner —
 * see the implementation report for the transcript.
 *
 * Run with: DATABASE_URL=... npm run test:db
 * (excluded from the default `npm test` run — see jest.config.js)
 */
import { PrismaClient } from "@prisma/client";
import { LogisticsQuoteService } from "../../src/modules/logistics/logistics-quote.service";
import { PrismaLogisticsQuoteRepository } from "../../src/modules/logistics/logistics-quote.repository";
import { PrismaLogisticsRequestRepository } from "../../src/modules/logistics/logistics-request.repository";
import { LogisticsAuthorizationService } from "../../src/modules/logistics/logistics.authorization";
import { VehicleEligibilityService } from "../../src/modules/logistics/vehicle-eligibility.service";
import { PrismaCropLotRepository } from "../../src/modules/lots/lots.repository";
import { FarmerProfileResolver } from "../../src/modules/farmers/farmer-profile.resolver";
import { PrismaFarmerProfileRepository } from "../../src/modules/farmers/farmer-profile.repository";
import { FpoAuthorizationService } from "../../src/modules/fpo/fpo.authorization";
import { PrismaFpoAdminRepository } from "../../src/modules/fpo/fpo-admin.repository";
import { TransporterAuthorizationService } from "../../src/modules/transporters/transporter.authorization";
import { PrismaTransporterRepository } from "../../src/modules/transporters/transporter.repository";
import { PrismaVehicleRepository } from "../../src/modules/transporters/vehicle.repository";
import { FakeAuditService } from "../testUtils/fakeAuditService";

const prisma = new PrismaClient();
const audit = new FakeAuditService();

const cropLots = new PrismaCropLotRepository(prisma);
const farmerProfiles = new FarmerProfileResolver(new PrismaFarmerProfileRepository(prisma));
const fpoAuthorization = new FpoAuthorizationService(new PrismaFpoAdminRepository(prisma));
const logisticsAuthorization = new LogisticsAuthorizationService(fpoAuthorization);
const transporterRepository = new PrismaTransporterRepository(prisma);
const vehicleRepository = new PrismaVehicleRepository(prisma);
const transporterAuthorization = new TransporterAuthorizationService(transporterRepository);
const vehicleEligibility = new VehicleEligibilityService();

const requests = new PrismaLogisticsRequestRepository(prisma);
const quotes = new PrismaLogisticsQuoteRepository(prisma);

const service = new LogisticsQuoteService(
  quotes,
  requests,
  cropLots,
  farmerProfiles,
  logisticsAuthorization,
  transporterAuthorization,
  transporterRepository,
  vehicleRepository,
  vehicleEligibility,
  audit,
);

function ctx(user: { id: string; publicId: string; role: string }) {
  return { id: user.id, publicId: user.publicId, role: user.role as any };
}

async function seedUser(role: "FARMER" | "TRANSPORTER", suffix: string) {
  return prisma.user.create({
    data: {
      fullName: `${role} Test ${suffix}`,
      mobile: `9${suffix.padStart(9, "0")}`,
      passwordHash: "test-hash",
      role,
      accountStatus: "ACTIVE",
    },
  });
}

async function seedScenario() {
  const crop = await prisma.crop.create({ data: { name: `LogisticsTestCrop-${Date.now()}-${Math.random()}` } });

  const farmerUser = await seedUser("FARMER", String(Math.floor(Math.random() * 1e8)));
  const farmerProfile = await prisma.farmerProfile.create({ data: { userId: farmerUser.id } });

  const lot = await prisma.cropLot.create({
    data: {
      lotNumber: `LOT-LOGISTICS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      ownerType: "FARMER",
      sourceType: "FARMER_CREATED",
      farmerId: farmerProfile.id,
      cropId: crop.id,
      unit: "KG",
      quantityKg: "5000",
      availableQuantityKg: "5000",
      availabilityDate: new Date(),
      originDistrict: "Ujjain",
      originState: "Madhya Pradesh",
    },
  });

  const request = await prisma.logisticsRequest.create({
    data: {
      lotId: lot.id,
      requesterUserId: farmerUser.id,
      cropId: crop.id,
      requiredQuantityKg: "2000",
      quantityUnit: "KG",
      pickupDistrict: "Ujjain",
      pickupState: "Madhya Pradesh",
      destinationDistrict: "Indore",
      destinationState: "Madhya Pradesh",
      status: "OPEN",
    },
  });

  async function seedProviderWithQuote(suffix: string, quotedAmount: string) {
    const transporterUser = await seedUser("TRANSPORTER", suffix);
    const transporter = await prisma.transporterProfile.create({
      data: { userId: transporterUser.id, businessName: `Carrier ${suffix}`, verificationStatus: "VERIFIED", isActive: true },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        transporterId: transporter.id,
        registrationNumber: `MP09TEST${suffix}`,
        normalizedRegistrationNumber: `MP09TEST${suffix}`,
        vehicleType: "MEDIUM_TRUCK",
        capacityUnit: "KG",
        capacityKg: "5000",
        status: "ACTIVE",
        verificationStatus: "VERIFIED",
        availabilityStatus: "AVAILABLE",
      },
    });
    const quote = await prisma.logisticsQuote.create({
      data: {
        logisticsRequestId: request.id,
        transportProviderId: transporter.id,
        vehicleId: vehicle.id,
        quotedAmount,
        currency: "INR",
        status: "SUBMITTED",
        submittedAt: new Date(),
        validUntil: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });
    return { transporterUser, transporter, vehicle, quote };
  }

  const providerA = await seedProviderWithQuote("A" + Math.floor(Math.random() * 1e6), "5000");
  const providerB = await seedProviderWithQuote("B" + Math.floor(Math.random() * 1e6), "5200");

  return { farmerUser, lot, request, providerA, providerB };
}

describe("LogisticsQuoteService.acceptQuote — concurrent acceptance (Step 8/11/15)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("never accepts two competing quotes on the same request — exactly one wins", async () => {
    const { farmerUser, providerA, providerB } = await seedScenario();
    const farmerContext = ctx(farmerUser);

    const results = await Promise.allSettled([
      service.acceptQuote(farmerContext, providerA.quote.publicId),
      service.acceptQuote(farmerContext, providerB.quote.publicId),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBe(1); // exactly one of the two must win

    const finalQuoteA = await prisma.logisticsQuote.findUniqueOrThrow({ where: { id: providerA.quote.id } });
    const finalQuoteB = await prisma.logisticsQuote.findUniqueOrThrow({ where: { id: providerB.quote.id } });
    const statuses = [finalQuoteA.status, finalQuoteB.status].sort();
    expect(statuses).toEqual(["ACCEPTED", "REJECTED"]);
  });

  it("the losing accept attempt gets an explainable domain error, not a silent failure", async () => {
    const { farmerUser, providerA, providerB } = await seedScenario();
    const farmerContext = ctx(farmerUser);

    const results = await Promise.allSettled([
      service.acceptQuote(farmerContext, providerA.quote.publicId),
      service.acceptQuote(farmerContext, providerB.quote.publicId),
    ]);

    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    expect(failed).toBeDefined();
    expect(failed!.reason).toBeInstanceOf(Error);
  });

  it("reserves the winning vehicle's availability after acceptance", async () => {
    const { farmerUser, providerA } = await seedScenario();
    await service.acceptQuote(ctx(farmerUser), providerA.quote.publicId);
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: providerA.vehicle.id } });
    expect(vehicle.availabilityStatus).toBe("RESERVED");
  });

  it("rejects accepting an already-expired quote instead of silently succeeding", async () => {
    const { farmerUser, providerA } = await seedScenario();
    await prisma.logisticsQuote.update({
      where: { id: providerA.quote.id },
      data: { validUntil: new Date(Date.now() - 60_000) },
    });
    await expect(service.acceptQuote(ctx(farmerUser), providerA.quote.publicId)).rejects.toThrow(/expired/i);
  });

  it("marks the logistics request QUOTE_ACCEPTED exactly once acceptance succeeds", async () => {
    const { farmerUser, request, providerA } = await seedScenario();
    await service.acceptQuote(ctx(farmerUser), providerA.quote.publicId);
    const finalRequest = await prisma.logisticsRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(finalRequest.status).toBe("QUOTE_ACCEPTED");
    expect(finalRequest.acceptedQuoteId).toBe(providerA.quote.id);
  });
});
