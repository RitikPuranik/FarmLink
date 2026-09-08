jest.mock("../../src/config/posthog", () => ({ trackEvent: jest.fn() }));

import { ConflictError, NotFoundError, TransporterDomainError } from "../../src/common/errors";
import { AuthenticatedUserContext } from "../../src/modules/auth/auth.types";
import { TransporterAuthorizationService } from "../../src/modules/transporters/transporter.authorization";
import { TransporterRepository } from "../../src/modules/transporters/transporter.repository";
import { VehicleRepository } from "../../src/modules/transporters/vehicle.repository";
import { VehicleService } from "../../src/modules/transporters/vehicle.service";

function makeProfile(overrides: Partial<any> = {}) {
  return { id: "transporter-1", userId: "user-1", verificationStatus: "PENDING", isActive: true, ...overrides };
}

function makeVehicle(overrides: Partial<any> = {}) {
  return {
    id: "vehicle-1",
    publicId: "pub-vehicle-1",
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

const transporterUser: AuthenticatedUserContext = { id: "user-1", publicId: "pub-user-1", role: "TRANSPORTER" };
const otherTransporterUser: AuthenticatedUserContext = { id: "user-2", publicId: "pub-user-2", role: "TRANSPORTER" };
const adminUser: AuthenticatedUserContext = { id: "admin-1", publicId: "pub-admin-1", role: "ADMIN" };
const meta = {};

describe("VehicleService", () => {
  let vehicles: jest.Mocked<VehicleRepository>;
  let transporters: jest.Mocked<TransporterRepository>;
  let audit: { record: jest.Mock };
  let authorization: TransporterAuthorizationService;
  let service: VehicleService;

  beforeEach(() => {
    vehicles = {
      create: jest.fn(),
      findById: jest.fn(),
      findByPublicId: jest.fn(),
      findByNormalizedRegistrationNumber: jest.fn(),
      listByTransporter: jest.fn(),
      discover: jest.fn(),
      update: jest.fn(),
      updateStatus: jest.fn(),
      updateAvailability: jest.fn(),
      updateVerification: jest.fn(),
      isRegistrationTaken: jest.fn(),
    } as unknown as jest.Mocked<VehicleRepository>;

    transporters = {
      findByUserId: jest.fn(),
    } as unknown as jest.Mocked<TransporterRepository>;

    audit = { record: jest.fn().mockResolvedValue(undefined) };
    authorization = new TransporterAuthorizationService(transporters);
    service = new VehicleService(vehicles, authorization, audit as any);

    transporters.findByUserId.mockResolvedValue(makeProfile());
  });

  describe("registerVehicle", () => {
    it("registers a vehicle for the caller's own transporter profile", async () => {
      vehicles.isRegistrationTaken.mockResolvedValue(false);
      vehicles.create.mockResolvedValue(makeVehicle());

      const result = await service.registerVehicle(
        transporterUser,
        { registrationNumber: "MH-12-AB-1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" },
        meta,
      );

      expect(result.registrationNumber).toBe("MH12AB1234");
      expect(vehicles.create).toHaveBeenCalledWith(
        expect.objectContaining({ transporterId: "transporter-1", normalizedRegistrationNumber: "MH12AB1234", capacityKg: 5000 }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "VEHICLE_REGISTERED" }));
    });

    it("rejects a duplicate registration", async () => {
      vehicles.isRegistrationTaken.mockResolvedValue(true);

      await expect(
        service.registerVehicle(
          transporterUser,
          { registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" },
          meta,
        ),
      ).rejects.toThrow(ConflictError);
      expect(vehicles.create).not.toHaveBeenCalled();
    });

    it("rejects invalid capacity", async () => {
      vehicles.isRegistrationTaken.mockResolvedValue(false);

      await expect(
        service.registerVehicle(
          transporterUser,
          { registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: -1, capacityUnit: "KG" },
          meta,
        ),
      ).rejects.toThrow(TransporterDomainError);
      expect(vehicles.create).not.toHaveBeenCalled();
    });

    it("rejects an invalid registration number", async () => {
      await expect(
        service.registerVehicle(
          transporterUser,
          { registrationNumber: "@@", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" },
          meta,
        ),
      ).rejects.toThrow(TransporterDomainError);
      expect(vehicles.isRegistrationTaken).not.toHaveBeenCalled();
    });

    it("turns a race-condition P2002 into ConflictError", async () => {
      vehicles.isRegistrationTaken.mockResolvedValue(false);
      vehicles.create.mockRejectedValue({ code: "P2002" });

      await expect(
        service.registerVehicle(
          transporterUser,
          { registrationNumber: "MH12AB1234", vehicleType: "MEDIUM_TRUCK", capacityValue: 5000, capacityUnit: "KG" },
          meta,
        ),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("getVehicle / listMyVehicles / ownership", () => {
    it("returns a vehicle the caller owns", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle());
      const result = await service.getVehicle(transporterUser, "pub-vehicle-1");
      expect(result.vehicleId).toBe("pub-vehicle-1");
    });

    it("404s (not 403) when the vehicle belongs to a different transporter", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile({ id: "transporter-2", userId: "user-2" }));
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ transporterId: "transporter-1" }));

      await expect(service.getVehicle(otherTransporterUser, "pub-vehicle-1")).rejects.toThrow(NotFoundError);
    });

    it("404s for a nonexistent vehicle", async () => {
      vehicles.findByPublicId.mockResolvedValue(null);
      await expect(service.getVehicle(transporterUser, "unknown")).rejects.toThrow(NotFoundError);
    });

    it("allows an admin to access any vehicle", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle());
      const result = await service.getVehicle(adminUser, "pub-vehicle-1");
      expect(result.vehicleId).toBe("pub-vehicle-1");
    });

    it("lists only the caller's own vehicles, paginated", async () => {
      vehicles.listByTransporter.mockResolvedValue({ items: [makeVehicle()], total: 1 });

      const result = await service.listMyVehicles(transporterUser, { page: 1, limit: 20 });
      expect(vehicles.listByTransporter).toHaveBeenCalledWith({ transporterId: "transporter-1", page: 1, limit: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });
  });

  describe("updateVehicle", () => {
    it("updates declared attributes", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle());
      vehicles.update.mockResolvedValue(makeVehicle({ isRefrigerated: true }));

      const result = await service.updateVehicle(transporterUser, "pub-vehicle-1", { isRefrigerated: true }, meta);
      expect(result.isRefrigerated).toBe(true);
    });

    it("re-validates capacity on update", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle());

      await expect(
        service.updateVehicle(transporterUser, "pub-vehicle-1", { capacityValue: -5, capacityUnit: "KG" }, meta),
      ).rejects.toThrow(TransporterDomainError);
      expect(vehicles.update).not.toHaveBeenCalled();
    });
  });

  describe("updateAvailability (Part G)", () => {
    it("sets AVAILABLE", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle());
      vehicles.updateAvailability.mockResolvedValue(makeVehicle({ availabilityStatus: "AVAILABLE" }));

      const result = await service.updateAvailability(transporterUser, "pub-vehicle-1", "AVAILABLE", meta);
      expect(result.availabilityStatus).toBe("AVAILABLE");
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "VEHICLE_AVAILABILITY_UPDATED" }));
    });

    it("sets UNAVAILABLE", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ availabilityStatus: "AVAILABLE" }));
      vehicles.updateAvailability.mockResolvedValue(makeVehicle({ availabilityStatus: "UNAVAILABLE" }));

      const result = await service.updateAvailability(transporterUser, "pub-vehicle-1", "UNAVAILABLE", meta);
      expect(result.availabilityStatus).toBe("UNAVAILABLE");
    });

    it("rejects RESERVED — reserved for future modules", async () => {
      await expect(
        service.updateAvailability(transporterUser, "pub-vehicle-1", "RESERVED" as any, meta),
      ).rejects.toThrow(TransporterDomainError);
      expect(vehicles.updateAvailability).not.toHaveBeenCalled();
    });

    it("rejects IN_TRANSIT — reserved for future modules", async () => {
      await expect(
        service.updateAvailability(transporterUser, "pub-vehicle-1", "IN_TRANSIT" as any, meta),
      ).rejects.toThrow(TransporterDomainError);
    });

    it("404s for someone else's vehicle", async () => {
      transporters.findByUserId.mockResolvedValue(makeProfile({ id: "transporter-2", userId: "user-2" }));
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ transporterId: "transporter-1" }));

      await expect(
        service.updateAvailability(otherTransporterUser, "pub-vehicle-1", "AVAILABLE", meta),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("updateStatus / deactivateVehicle", () => {
    it("allows ACTIVE -> INACTIVE by the owner", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ status: "ACTIVE" }));
      vehicles.updateStatus.mockResolvedValue(makeVehicle({ status: "INACTIVE" }));

      const result = await service.deactivateVehicle(transporterUser, "pub-vehicle-1", meta);
      expect(result.status).toBe("INACTIVE");
    });

    it("rejects a non-admin trying to suspend", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ status: "ACTIVE" }));

      await expect(
        service.updateStatus(transporterUser, "pub-vehicle-1", "SUSPENDED", meta),
      ).rejects.toThrow(TransporterDomainError);
      expect(vehicles.updateStatus).not.toHaveBeenCalled();
    });

    it("allows an admin to suspend", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ status: "ACTIVE" }));
      vehicles.updateStatus.mockResolvedValue(makeVehicle({ status: "SUSPENDED" }));

      const result = await service.updateStatus(adminUser, "pub-vehicle-1", "SUSPENDED", meta);
      expect(result.status).toBe("SUSPENDED");
    });

    it("rejects an invalid transition (SUSPENDED -> MAINTENANCE)", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ status: "SUSPENDED" }));

      await expect(
        service.updateStatus(adminUser, "pub-vehicle-1", "MAINTENANCE", meta),
      ).rejects.toThrow(TransporterDomainError);
    });

    it("allows an admin to reactivate SUSPENDED -> ACTIVE", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ status: "SUSPENDED" }));
      vehicles.updateStatus.mockResolvedValue(makeVehicle({ status: "ACTIVE" }));

      const result = await service.updateStatus(adminUser, "pub-vehicle-1", "ACTIVE", meta);
      expect(result.status).toBe("ACTIVE");
    });
  });

  describe("verifyVehicle (Part J)", () => {
    it("allows PENDING -> VERIFIED", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ verificationStatus: "PENDING" }));
      vehicles.updateVerification.mockResolvedValue(makeVehicle({ verificationStatus: "VERIFIED" }));

      const result = await service.verifyVehicle(adminUser, "pub-vehicle-1", "VERIFIED", meta);
      expect(result.verificationStatus).toBe("VERIFIED");
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "VEHICLE_VERIFIED" }));
    });

    it("allows PENDING -> REJECTED", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ verificationStatus: "PENDING" }));
      vehicles.updateVerification.mockResolvedValue(makeVehicle({ verificationStatus: "REJECTED" }));

      const result = await service.verifyVehicle(adminUser, "pub-vehicle-1", "REJECTED", meta);
      expect(result.verificationStatus).toBe("REJECTED");
    });

    it("rejects VERIFIED -> REJECTED (no further transitions)", async () => {
      vehicles.findByPublicId.mockResolvedValue(makeVehicle({ verificationStatus: "VERIFIED" }));

      await expect(
        service.verifyVehicle(adminUser, "pub-vehicle-1", "REJECTED", meta),
      ).rejects.toThrow(TransporterDomainError);
    });

    it("404s for an unknown vehicle", async () => {
      vehicles.findByPublicId.mockResolvedValue(null);
      await expect(service.verifyVehicle(adminUser, "unknown", "VERIFIED", meta)).rejects.toThrow(NotFoundError);
    });
  });
});
