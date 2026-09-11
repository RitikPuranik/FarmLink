import {
  EligibilityCandidateProvider,
  EligibilityCandidateVehicle,
  VehicleEligibilityService,
} from "../../src/modules/logistics/vehicle-eligibility.service";

function vehicle(overrides: Partial<EligibilityCandidateVehicle> = {}): EligibilityCandidateVehicle {
  return {
    id: "vehicle-1",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    availabilityStatus: "AVAILABLE",
    capacityKg: 5000,
    capabilities: ["COVERED"],
    isRefrigerated: false,
    ...overrides,
  };
}

function provider(overrides: Partial<EligibilityCandidateProvider> = {}): EligibilityCandidateProvider {
  return { id: "provider-1", isActive: true, verificationStatus: "VERIFIED", ...overrides };
}

describe("VehicleEligibilityService", () => {
  const service = new VehicleEligibilityService();

  it("is eligible when every check passes", () => {
    const result = service.evaluate(vehicle(), provider(), {
      requiredCapacityKg: 2000,
      requiresRefrigeration: false,
      requiredCapabilities: ["COVERED"],
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("never selects an insufficient-capacity vehicle (does not silently allow a 5-ton requirement onto a 2-ton vehicle)", () => {
    const result = service.evaluate(vehicle({ capacityKg: 2000 }), provider(), {
      requiredCapacityKg: 5000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VEHICLE_CAPACITY_INSUFFICIENT");
  });

  it("rejects an inactive vehicle", () => {
    const result = service.evaluate(vehicle({ status: "MAINTENANCE" }), provider(), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VEHICLE_INACTIVE");
  });

  it("rejects an unavailable vehicle", () => {
    const result = service.evaluate(vehicle({ availabilityStatus: "UNAVAILABLE" }), provider(), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VEHICLE_UNAVAILABLE");
  });

  it("requires refrigeration when the request needs it", () => {
    const result = service.evaluate(vehicle({ isRefrigerated: false }), provider(), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: true,
      requiredCapabilities: [],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VEHICLE_REFRIGERATION_REQUIRED");
  });

  it("requires every requested capability to be present on the vehicle", () => {
    const result = service.evaluate(vehicle({ capabilities: ["COVERED"] }), provider(), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: ["COVERED", "TEMPERATURE_CONTROLLED"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VEHICLE_CAPABILITY_MISSING");
  });

  it("rejects an inactive/suspended provider even if the vehicle itself is fine", () => {
    const inactive = service.evaluate(vehicle(), provider({ isActive: false }), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
    });
    expect(inactive.reasons).toContain("PROVIDER_INACTIVE");

    const suspended = service.evaluate(vehicle(), provider({ verificationStatus: "SUSPENDED" }), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
    });
    expect(suspended.reasons).toContain("PROVIDER_SUSPENDED");
  });

  it("rejects an unverified vehicle/provider by default", () => {
    const result = service.evaluate(vehicle({ verificationStatus: "PENDING" }), provider({ verificationStatus: "PENDING" }), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VEHICLE_NOT_VERIFIED");
    expect(result.reasons).toContain("PROVIDER_NOT_VERIFIED");
  });

  it("allows requireVerified: false to relax the verification checks", () => {
    const result = service.evaluate(vehicle({ verificationStatus: "PENDING" }), provider({ verificationStatus: "PENDING" }), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
      requireVerified: false,
    });
    expect(result.reasons).not.toContain("VEHICLE_NOT_VERIFIED");
    expect(result.reasons).not.toContain("PROVIDER_NOT_VERIFIED");
  });

  it("flags a vehicle already committed to a conflicting window", () => {
    const result = service.evaluate(vehicle(), provider(), {
      requiredCapacityKg: 1000,
      requiresRefrigeration: false,
      requiredCapabilities: [],
      hasConflictingCommitment: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("VEHICLE_ALREADY_COMMITTED");
  });

  it("never silently excludes a vehicle: every rejection returns at least one explicit reason", () => {
    const result = service.evaluate(
      vehicle({ status: "SUSPENDED", availabilityStatus: "UNAVAILABLE", capacityKg: 100 }),
      provider({ isActive: false }),
      { requiredCapacityKg: 5000, requiresRefrigeration: true, requiredCapabilities: ["COVERED"] },
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});
