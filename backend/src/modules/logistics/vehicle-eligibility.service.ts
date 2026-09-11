/**
 * Step 5 — Vehicle Eligibility. Deliberately decoupled from `@prisma/client`
 * generated types: callers (LogisticsRequestService) map a Module 15
 * Vehicle/TransporterProfile row into the small candidate shape below, so
 * this file is a pure function of its inputs and stays independently
 * unit-testable. Never silently excludes a vehicle (Step 5) — every
 * rejection is returned as an explicit, explainable reason code.
 */

export type EligibilityReason =
  | "VEHICLE_INACTIVE"
  | "VEHICLE_NOT_VERIFIED"
  | "VEHICLE_UNAVAILABLE"
  | "VEHICLE_CAPACITY_INSUFFICIENT"
  | "VEHICLE_REFRIGERATION_REQUIRED"
  | "VEHICLE_CAPABILITY_MISSING"
  | "VEHICLE_ALREADY_COMMITTED"
  | "PROVIDER_INACTIVE"
  | "PROVIDER_SUSPENDED"
  | "PROVIDER_NOT_VERIFIED";

export interface EligibilityCandidateVehicle {
  id: string;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SUSPENDED";
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  availabilityStatus: "AVAILABLE" | "UNAVAILABLE" | "RESERVED" | "IN_TRANSIT";
  capacityKg: number;
  capabilities: string[];
  isRefrigerated: boolean;
}

export interface EligibilityCandidateProvider {
  id: string;
  isActive: boolean;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
}

export interface EligibilityRequirement {
  requiredCapacityKg: number;
  requiresRefrigeration: boolean;
  requiredCapabilities: string[];
  /** Step 5: "vehicle is not already committed to an incompatible
   * shipment/time window" — the caller resolves this (it needs a DB
   * lookup against other ACCEPTED quotes for the same vehicle in an
   * overlapping window), this function only reflects the answer. */
  hasConflictingCommitment?: boolean;
  /** Whether an unverified vehicle/provider should be excluded. Defaults
   * to true — a farmer should not be matched to an unverified provider by
   * default, but an ADMIN-configured deployment may relax this while
   * verification backlog clears. */
  requireVerified?: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
}

export class VehicleEligibilityService {
  evaluate(
    vehicle: EligibilityCandidateVehicle,
    provider: EligibilityCandidateProvider,
    requirement: EligibilityRequirement,
  ): EligibilityResult {
    const reasons: EligibilityReason[] = [];
    const requireVerified = requirement.requireVerified ?? true;

    if (!provider.isActive) reasons.push("PROVIDER_INACTIVE");
    if (provider.verificationStatus === "SUSPENDED") reasons.push("PROVIDER_SUSPENDED");
    if (requireVerified && provider.verificationStatus !== "VERIFIED") reasons.push("PROVIDER_NOT_VERIFIED");

    if (vehicle.status !== "ACTIVE") reasons.push("VEHICLE_INACTIVE");
    if (requireVerified && vehicle.verificationStatus !== "VERIFIED") reasons.push("VEHICLE_NOT_VERIFIED");
    if (vehicle.availabilityStatus !== "AVAILABLE") reasons.push("VEHICLE_UNAVAILABLE");

    if (vehicle.capacityKg < requirement.requiredCapacityKg) reasons.push("VEHICLE_CAPACITY_INSUFFICIENT");

    if (requirement.requiresRefrigeration && !vehicle.isRefrigerated) reasons.push("VEHICLE_REFRIGERATION_REQUIRED");

    const missingCapabilities = requirement.requiredCapabilities.filter((c) => !vehicle.capabilities.includes(c));
    if (missingCapabilities.length > 0) reasons.push("VEHICLE_CAPABILITY_MISSING");

    if (requirement.hasConflictingCommitment) reasons.push("VEHICLE_ALREADY_COMMITTED");

    return { eligible: reasons.length === 0, reasons };
  }
}
