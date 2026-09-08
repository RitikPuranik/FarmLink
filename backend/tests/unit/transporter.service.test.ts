jest.mock("../../src/config/posthog", () => ({ trackEvent: jest.fn() }));

import { ConflictError, NotFoundError, TransporterDomainError } from "../../src/common/errors";
import { AuthenticatedUserContext } from "../../src/modules/auth/auth.types";
import { TransporterAuthorizationService } from "../../src/modules/transporters/transporter.authorization";
import { TransporterRepository } from "../../src/modules/transporters/transporter.repository";
import { TransporterServiceAreaRepository } from "../../src/modules/transporters/transporter-service-area.repository";
import { TransporterService } from "../../src/modules/transporters/transporter.service";
import { VehicleRepository } from "../../src/modules/transporters/vehicle.repository";

function makeProfile(overrides: Partial<any> = {}) {
  return {
    id: "transporter-1",
    publicId: "pub-transporter-1",
    userId: "user-1",
    providerType: "INDIVIDUAL",
    businessName: "Acme Logistics",
    legalName: null,
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

const transporterUser: AuthenticatedUserContext = { id: "user-1", publicId: "pub-user-1", role: "TRANSPORTER" };
const otherTransporterUser: AuthenticatedUserContext = { id: "user-2", publicId: "pub-user-2", role: "TRANSPORTER" };
const adminUser: AuthenticatedUserContext = { id: "admin-1", publicId: "pub-admin-1", role: "ADMIN" };
const meta = {};

describe("TransporterService", () => {
  let transporters: jest.Mocked<TransporterRepository>;
  let serviceAreas: jest.Mocked<TransporterServiceAreaRepository>;
  let vehicles: jest.Mocked<VehicleRepository>;
  let audit: { record: jest.Mock };
  let authorization: TransporterAuthorizationService;
  let service: TransporterService;

  beforeEach(() => {
    transporters = {
      findById: jest.fn(),
      findByUserId: jest.fn(),
      findByPublicId: jest.fn(),
      create: jest.fn(),
      updateProfile: jest.fn(),
      updateVerificationStatus: jest.fn(),
      search: jest.fn(),
      countVehicles: jest.fn(),
      countVehiclesForMany: jest.fn(),
      listServiceAreas: jest.fn(),
      listServiceAreasForMany: jest.fn(),
    } as unknown as jest.Mocked<TransporterRepository>;

    serviceAreas = {
      create: jest.fn(),
      findById: jest.fn(),
      listByTransporter: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<TransporterServiceAreaRepository>;

    vehicles = {
      discover: jest.fn(),
    } as unknown as jest.Mocked<VehicleRepository>;

    audit = { record: jest.fn().mockResolvedValue(undefined) };
    authorization = new TransporterAuthorizationService(transporters);
    service = new TransporterService(transporters, serviceAreas, vehicles, authorization, audit as any);

    transporters.countVehicles.mockResolvedValue(0);
    transporters.listServiceAreasForMany.mockResolvedValue({});
    transporters.countVehiclesForMany.mockResolvedValue({});
    serviceAreas.listByTransporter.mockResolvedValue([]);
  });

  describe("createProfile", () => {
    it("creates a profile for a first-time transporter", async () => {
      transporters.findByUserId.mockResolvedValue(null);
      transporters.create.mockResolvedValue(makeProfile());

      const result = await service.createProfile(transporterUser, { businessName: "Acme Logistics" }, meta);

      expect(result.verificationStatus).toBe("PENDING");
      expect(transporters.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "TRANSPORTER_PROFILE_CREATED" }));
    });

    it("rejects a duplicate profile", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile());

      await expect(service.createProfile(transporterUser, {}, meta)).rejects.toThrow(ConflictError);
      expect(transporters.create).not.toHaveBeenCalled();
    });

    it("defaults providerType to INDIVIDUAL when not specified", async () => {
      transporters.findByUserId.mockResolvedValue(null);
      transporters.create.mockResolvedValue(makeProfile());

      await service.createProfile(transporterUser, { businessName: "Ramesh Transport" }, meta);

      expect(transporters.create).toHaveBeenCalledWith(expect.objectContaining({ providerType: "INDIVIDUAL" }));
    });

    it("honors an explicit COMPANY providerType — same TransporterProfile -> Vehicle[] shape as an individual", async () => {
      transporters.findByUserId.mockResolvedValue(null);
      transporters.create.mockResolvedValue(makeProfile({ providerType: "COMPANY", businessName: "ABC Logistics Pvt Ltd" }));

      const result = await service.createProfile(
        transporterUser,
        { providerType: "COMPANY", businessName: "ABC Logistics Pvt Ltd", legalName: "ABC Logistics Private Limited" },
        meta,
      );

      expect(transporters.create).toHaveBeenCalledWith(
        expect.objectContaining({ providerType: "COMPANY", legalName: "ABC Logistics Private Limited" }),
      );
      expect(result.providerType).toBe("COMPANY");
    });
  });

  describe("getMyProfile / updateMyProfile", () => {
    it("returns the caller's own profile", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile());

      const result = await service.getMyProfile(transporterUser);
      expect(result.transporterId).toBe("pub-transporter-1");
    });

    it("throws NotFoundError when no profile exists yet", async () => {
      transporters.findByUserId.mockResolvedValue(null);
      await expect(service.getMyProfile(transporterUser)).rejects.toThrow(NotFoundError);
    });

    it("updates the caller's own profile", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile());
      transporters.updateProfile.mockResolvedValue(makeProfile({ businessName: "New Name" }));

      const result = await service.updateMyProfile(transporterUser, { businessName: "New Name" }, meta);
      expect(result.businessName).toBe("New Name");
      expect(transporters.updateProfile).toHaveBeenCalledWith("transporter-1", expect.objectContaining({ businessName: "New Name" }));
    });
  });

  describe("setVerificationStatus (Part I state machine)", () => {
    it("allows PENDING -> VERIFIED", async () => {
      transporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "PENDING" }));
      transporters.updateVerificationStatus.mockResolvedValue(makeProfile({ verificationStatus: "VERIFIED" }));

      const result = await service.setVerificationStatus(adminUser, "pub-transporter-1", "VERIFIED", meta);
      expect(result.verificationStatus).toBe("VERIFIED");
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "TRANSPORTER_VERIFIED" }));
    });

    it("allows PENDING -> REJECTED", async () => {
      transporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "PENDING" }));
      transporters.updateVerificationStatus.mockResolvedValue(makeProfile({ verificationStatus: "REJECTED" }));

      const result = await service.setVerificationStatus(adminUser, "pub-transporter-1", "REJECTED", meta);
      expect(result.verificationStatus).toBe("REJECTED");
    });

    it("allows VERIFIED -> SUSPENDED", async () => {
      transporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "VERIFIED" }));
      transporters.updateVerificationStatus.mockResolvedValue(makeProfile({ verificationStatus: "SUSPENDED" }));

      const result = await service.setVerificationStatus(adminUser, "pub-transporter-1", "SUSPENDED", meta);
      expect(result.verificationStatus).toBe("SUSPENDED");
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "TRANSPORTER_SUSPENDED" }));
    });

    it("allows SUSPENDED -> VERIFIED (reactivation)", async () => {
      transporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "SUSPENDED" }));
      transporters.updateVerificationStatus.mockResolvedValue(makeProfile({ verificationStatus: "VERIFIED" }));

      await service.setVerificationStatus(adminUser, "pub-transporter-1", "VERIFIED", meta);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "TRANSPORTER_REACTIVATED" }));
    });

    it("rejects PENDING -> SUSPENDED (invalid transition)", async () => {
      transporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "PENDING" }));

      await expect(
        service.setVerificationStatus(adminUser, "pub-transporter-1", "SUSPENDED", meta),
      ).rejects.toThrow(TransporterDomainError);
      expect(transporters.updateVerificationStatus).not.toHaveBeenCalled();
    });

    it("rejects REJECTED -> anything (terminal state)", async () => {
      transporters.findByPublicId.mockResolvedValue(makeProfile({ verificationStatus: "REJECTED" }));

      await expect(
        service.setVerificationStatus(adminUser, "pub-transporter-1", "VERIFIED", meta),
      ).rejects.toThrow(TransporterDomainError);
    });

    it("404s for an unknown transporter", async () => {
      transporters.findByPublicId.mockResolvedValue(null);
      await expect(
        service.setVerificationStatus(adminUser, "unknown", "VERIFIED", meta),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("service areas", () => {
    it("adds a STATE-level area", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile());
      serviceAreas.listByTransporter.mockResolvedValue([]);
      serviceAreas.create.mockResolvedValue({
        id: "area-1",
        transporterId: "transporter-1",
        areaType: "STATE",
        state: "Maharashtra",
        district: null,
        city: null,
        pincode: null,
        createdAt: new Date(),
      });

      const result = await service.addServiceArea(transporterUser, { areaType: "STATE", state: "Maharashtra" }, meta);
      expect(result.state).toBe("Maharashtra");
    });

    it("adds a DISTRICT-level area", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile());
      serviceAreas.listByTransporter.mockResolvedValue([]);
      serviceAreas.create.mockResolvedValue({
        id: "area-2",
        transporterId: "transporter-1",
        areaType: "DISTRICT",
        state: "Maharashtra",
        district: "Pune",
        city: null,
        pincode: null,
        createdAt: new Date(),
      });

      const result = await service.addServiceArea(
        transporterUser,
        { areaType: "DISTRICT", state: "Maharashtra", district: "Pune" },
        meta,
      );
      expect(result.district).toBe("Pune");
    });

    it("rejects an invalid hierarchy (DISTRICT without state)", async () => {
      await expect(
        service.addServiceArea(transporterUser, { areaType: "DISTRICT", district: "Pune" }, meta),
      ).rejects.toThrow(TransporterDomainError);
      expect(serviceAreas.create).not.toHaveBeenCalled();
    });

    it("rejects an invalid hierarchy (CITY without district)", async () => {
      await expect(
        service.addServiceArea(transporterUser, { areaType: "CITY", state: "Maharashtra", city: "Pune" }, meta),
      ).rejects.toThrow(TransporterDomainError);
    });

    it("rejects an invalid hierarchy (PINCODE without a pincode)", async () => {
      await expect(service.addServiceArea(transporterUser, { areaType: "PINCODE" }, meta)).rejects.toThrow(
        TransporterDomainError,
      );
    });

    it("rejects a duplicate service area", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile());
      serviceAreas.listByTransporter.mockResolvedValue([
        {
          id: "area-1",
          transporterId: "transporter-1",
          areaType: "DISTRICT",
          state: "Maharashtra",
          district: "Pune",
          city: null,
          pincode: null,
          createdAt: new Date(),
        },
      ]);

      await expect(
        service.addServiceArea(transporterUser, { areaType: "DISTRICT", state: "Maharashtra", district: "Pune" }, meta),
      ).rejects.toThrow(ConflictError);
      expect(serviceAreas.create).not.toHaveBeenCalled();
    });

    it("removes a service area the caller owns", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile());
      serviceAreas.findById.mockResolvedValue({
        id: "area-1",
        transporterId: "transporter-1",
        areaType: "STATE",
        state: "Maharashtra",
        district: null,
        city: null,
        pincode: null,
        createdAt: new Date(),
      });

      await service.removeServiceArea(transporterUser, "area-1", meta);
      expect(serviceAreas.remove).toHaveBeenCalledWith("area-1");
    });

    it("404s when removing a service area belonging to a different transporter", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile({ id: "transporter-1" }));
      serviceAreas.findById.mockResolvedValue({
        id: "area-1",
        transporterId: "someone-elses-transporter",
        areaType: "STATE",
        state: "Maharashtra",
        district: null,
        city: null,
        pincode: null,
        createdAt: new Date(),
      });

      await expect(service.removeServiceArea(transporterUser, "area-1", meta)).rejects.toThrow(NotFoundError);
      expect(serviceAreas.remove).not.toHaveBeenCalled();
    });
  });

  describe("listTransporters (Part N discovery)", () => {
    it("filters by state/district via the search repository", async () => {
      transporters.search.mockResolvedValue({ items: [], total: 0 });

      await service.listTransporters({ page: 1, limit: 20, state: "Maharashtra", district: "Pune" });

      expect(transporters.search).toHaveBeenCalledWith(
        expect.objectContaining({ state: "Maharashtra", district: "Pune", page: 1, limit: 20 }),
      );
    });

    it("filters by minimum capacity via vehicle discovery", async () => {
      vehicles.discover.mockResolvedValue(["transporter-1"]);
      transporters.search.mockResolvedValue({ items: [makeProfile()], total: 1 });

      const result = await service.listTransporters({ page: 1, limit: 20, minimumCapacityKg: 3000 });

      expect(vehicles.discover).toHaveBeenCalledWith(expect.objectContaining({ minimumCapacityKg: 3000 }));
      expect(transporters.search).toHaveBeenCalledWith(expect.objectContaining({ transporterIds: ["transporter-1"] }));
      expect(result.items).toHaveLength(1);
    });

    it("filters by refrigerated", async () => {
      vehicles.discover.mockResolvedValue(["transporter-1"]);
      transporters.search.mockResolvedValue({ items: [], total: 0 });

      await service.listTransporters({ page: 1, limit: 20, refrigerated: true });
      expect(vehicles.discover).toHaveBeenCalledWith(expect.objectContaining({ refrigerated: true }));
    });

    it("filters by availability", async () => {
      vehicles.discover.mockResolvedValue(["transporter-1"]);
      transporters.search.mockResolvedValue({ items: [], total: 0 });

      await service.listTransporters({ page: 1, limit: 20, availabilityStatus: "AVAILABLE" });
      expect(vehicles.discover).toHaveBeenCalledWith(expect.objectContaining({ availabilityStatus: "AVAILABLE" }));
    });

    it("filters by verification status", async () => {
      transporters.search.mockResolvedValue({ items: [], total: 0 });

      await service.listTransporters({ page: 1, limit: 20, verified: true });
      expect(transporters.search).toHaveBeenCalledWith(expect.objectContaining({ verificationStatus: "VERIFIED" }));
    });

    it("short-circuits to an empty page when no vehicle matches the filter", async () => {
      vehicles.discover.mockResolvedValue([]);

      const result = await service.listTransporters({ page: 1, limit: 20, refrigerated: true });
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(transporters.search).not.toHaveBeenCalled();
    });

    it("paginates results", async () => {
      transporters.search.mockResolvedValue({ items: [], total: 45 });

      const result = await service.listTransporters({ page: 2, limit: 20 });
      expect(result.pagination).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
      expect(transporters.search).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 20 }));
    });

    it("is deterministic: identical filters produce identical repository calls", async () => {
      transporters.search.mockResolvedValue({ items: [], total: 0 });

      const query = { page: 1, limit: 20, state: "Maharashtra" as const };
      await service.listTransporters(query);
      await service.listTransporters(query);

      expect(transporters.search).toHaveBeenNthCalledWith(1, transporters.search.mock.calls[1][0]);
    });
  });
});
