import {
  QuantityUnit,
  VehicleAvailabilityStatus,
  VehicleCapability,
  VehicleStatus,
  VehicleType,
  VehicleVerificationStatus,
} from "@prisma/client";
import { ConflictError, NotFoundError, TransporterDomainError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { TransporterAuthorizationService } from "./transporter.authorization";
import { validateAndNormalizeCapacity } from "./vehicle-capacity";
import { normalizeRegistrationNumber, validateRegistrationNumber } from "./vehicle-registration";
import { VehicleRecord, VehiclePublicDTO, toVehiclePublicDTO } from "./vehicle.types";
import { VehicleRepository } from "./vehicle.repository";

export interface RegisterVehicleInput {
  registrationNumber: string;
  vehicleType: VehicleType;
  capacityValue: number;
  capacityUnit: QuantityUnit;
  capabilities?: VehicleCapability[];
  isRefrigerated?: boolean;
}

/** Part 11 — bulk onboarding. Deliberately all-or-nothing (no partial
 * processing): every item is validated and checked for duplicates before
 * anything is written, then persisted in a single transaction. This
 * trades "report per-item success/failure for a partially-applied batch"
 * for "never leave an inconsistent fleet behind," per the instruction to
 * not compromise correctness for the sake of a convenience endpoint. */
export interface BulkRegisterVehicleItem extends RegisterVehicleInput {}

export interface BulkRegisterVehiclesInput {
  vehicles: BulkRegisterVehicleItem[];
}

export interface UpdateVehicleInput {
  vehicleType?: VehicleType;
  capacityValue?: number;
  capacityUnit?: QuantityUnit;
  capabilities?: VehicleCapability[];
  isRefrigerated?: boolean;
}

export interface ListMyVehiclesQuery {
  page: number;
  limit: number;
}

export interface PaginatedVehicles {
  items: VehiclePublicDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** Part J — PENDING -> VERIFIED/REJECTED only; deterministic, no further
 * transitions (unlike the transporter's own SUSPENDED/reactivate cycle). */
const ALLOWED_VERIFICATION_TRANSITIONS: Record<VehicleVerificationStatus, VehicleVerificationStatus[]> = {
  PENDING: ["VERIFIED", "REJECTED"],
  VERIFIED: [],
  REJECTED: [],
};

/** Part G — an operational status change (ACTIVE/INACTIVE/MAINTENANCE) is
 * always reversible by the owning transporter; SUSPENDED is admin-only
 * (enforced at the controller, not here) and, once suspended, only an
 * admin can move the vehicle back to ACTIVE. */
const ALLOWED_STATUS_TRANSITIONS: Record<VehicleStatus, VehicleStatus[]> = {
  ACTIVE: ["INACTIVE", "MAINTENANCE", "SUSPENDED"],
  INACTIVE: ["ACTIVE", "MAINTENANCE"],
  MAINTENANCE: ["ACTIVE", "INACTIVE"],
  SUSPENDED: ["ACTIVE"],
};

/** Part G — only the two owner-settable values ever flow through here;
 * RESERVED/IN_TRANSIT are reserved for Module 16/17 to set programmatically. */
const OWNER_SETTABLE_AVAILABILITY: VehicleAvailabilityStatus[] = ["AVAILABLE", "UNAVAILABLE"];

export class VehicleService {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly authorization: TransporterAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async loadOwnedOrThrow(
    user: AuthenticatedUserContext,
    publicId: string,
  ): Promise<VehicleRecord> {
    const vehicle = await this.vehicles.findByPublicId(publicId);
    if (!vehicle) throw new NotFoundError("Vehicle not found.");

    if (user.role !== "ADMIN") {
      const profile = await this.authorization.resolveOwnProfile(user);
      if (vehicle.transporterId !== profile.id) {
        throw new NotFoundError("Vehicle not found."); // Obfuscate cross-tenant access, same as NetRealization's lot lookups
      }
    }
    return vehicle;
  }

  async registerVehicle(
    user: AuthenticatedUserContext,
    input: RegisterVehicleInput,
    meta: RequestMeta,
  ): Promise<VehiclePublicDTO> {
    const profile = await this.authorization.resolveOwnProfile(user);

    const { valid, normalized, reason } = validateRegistrationNumber(input.registrationNumber);
    if (!valid) {
      throw new TransporterDomainError(reason ?? "Invalid registration number.", "INVALID_VEHICLE_REGISTRATION");
    }

    if (await this.vehicles.isRegistrationTaken(normalized)) {
      throw new ConflictError("A vehicle with this registration number is already registered.");
    }

    const capacityKg = validateAndNormalizeCapacity({ value: input.capacityValue, unit: input.capacityUnit });

    let vehicle: VehicleRecord;
    try {
      vehicle = await this.vehicles.create({
        transporterId: profile.id,
        registrationNumber: input.registrationNumber.trim(),
        normalizedRegistrationNumber: normalized,
        vehicleType: input.vehicleType,
        capacityUnit: input.capacityUnit,
        capacityKg,
        capabilities: input.capabilities ?? [],
        isRefrigerated: input.isRefrigerated ?? false,
      });
    } catch (err) {
      // Race-condition fallback: two concurrent requests both passed the
      // isRegistrationTaken() check above for the same normalized plate.
      if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
        throw new ConflictError("A vehicle with this registration number is already registered.");
      }
      throw err;
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "VEHICLE_REGISTERED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      // Never the raw registration number (Part T/U — PII/duplicate-hint
      // minimization in analytics/audit metadata).
      metadata: { vehicleType: vehicle.vehicleType },
      ...meta,
    });
    trackEvent("vehicle_registered", user.id, { vehicleType: vehicle.vehicleType });

    return toVehiclePublicDTO(vehicle);
  }

  async registerVehicleBulk(
    user: AuthenticatedUserContext,
    input: BulkRegisterVehiclesInput,
    meta: RequestMeta,
  ): Promise<VehiclePublicDTO[]> {
    const profile = await this.authorization.resolveOwnProfile(user);

    // Validate + normalize every item up front. Nothing is written to the
    // database until every single item in the batch has passed shape
    // validation (registration number, capacity) — an all-or-nothing
    // batch is only meaningful if we reject bad input before touching
    // the DB, not partway through.
    const normalizedItems = input.vehicles.map((item, index) => {
      const { valid, normalized, reason } = validateRegistrationNumber(item.registrationNumber);
      if (!valid) {
        throw new TransporterDomainError(
          `Vehicle at index ${index}: ${reason ?? "invalid registration number."}`,
          "INVALID_VEHICLE_REGISTRATION",
        );
      }
      const capacityKg = validateAndNormalizeCapacity({ value: item.capacityValue, unit: item.capacityUnit });
      return { index, item, normalized, capacityKg };
    });

    // Reject duplicate normalized registration numbers within the batch
    // itself (e.g. the same plate typed twice with different casing) —
    // the DB unique constraint would only catch this as an opaque
    // mid-transaction failure otherwise.
    const seen = new Map<string, number>();
    for (const { index, normalized } of normalizedItems) {
      const firstIndex = seen.get(normalized);
      if (firstIndex !== undefined) {
        throw new ConflictError(
          `Vehicles at index ${firstIndex} and ${index} have the same registration number.`,
        );
      }
      seen.set(normalized, index);
    }

    // Reject if any normalized plate is already registered to any
    // transporter — checked in one query rather than one-per-item.
    const normalizedValues = normalizedItems.map((n) => n.normalized);
    const existing = await this.vehicles.findByNormalizedRegistrationNumbers(normalizedValues);
    if (existing.length > 0) {
      const takenSet = new Set(existing.map((v) => v.normalizedRegistrationNumber));
      const conflicts = normalizedItems.filter((n) => takenSet.has(n.normalized)).map((n) => n.index);
      throw new ConflictError(
        `Vehicle(s) at index ${conflicts.join(", ")} have a registration number already registered.`,
      );
    }

    let vehicles: VehicleRecord[];
    try {
      vehicles = await this.vehicles.createMany(
        normalizedItems.map(({ item, normalized, capacityKg }) => ({
          transporterId: profile.id,
          registrationNumber: item.registrationNumber.trim(),
          normalizedRegistrationNumber: normalized,
          vehicleType: item.vehicleType,
          capacityUnit: item.capacityUnit,
          capacityKg,
          capabilities: item.capabilities ?? [],
          isRefrigerated: item.isRefrigerated ?? false,
        })),
      );
    } catch (err) {
      // Race-condition fallback: another request registered one of these
      // plates between our pre-check above and the transaction — the
      // transaction rolls back atomically (createMany), so no partial
      // fleet is left behind; surface it as a normal conflict.
      if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
        throw new ConflictError("One or more vehicles in this batch are already registered.");
      }
      throw err;
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "VEHICLE_BULK_REGISTERED",
      entityType: "Vehicle",
      entityId: profile.id,
      metadata: { count: vehicles.length },
      ...meta,
    });
    trackEvent("vehicle_registered", user.id, { bulk: true, count: vehicles.length });

    return vehicles.map(toVehiclePublicDTO);
  }

  async getVehicle(user: AuthenticatedUserContext, publicId: string): Promise<VehiclePublicDTO> {
    const vehicle = await this.loadOwnedOrThrow(user, publicId);
    return toVehiclePublicDTO(vehicle);
  }

  async listMyVehicles(
    user: AuthenticatedUserContext,
    query: ListMyVehiclesQuery,
  ): Promise<PaginatedVehicles> {
    const profile = await this.authorization.resolveOwnProfile(user);
    const { items, total } = await this.vehicles.listByTransporter({
      transporterId: profile.id,
      page: query.page,
      limit: query.limit,
    });

    return {
      items: items.map(toVehiclePublicDTO),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
    };
  }

  async updateVehicle(
    user: AuthenticatedUserContext,
    publicId: string,
    input: UpdateVehicleInput,
    meta: RequestMeta,
  ): Promise<VehiclePublicDTO> {
    const vehicle = await this.loadOwnedOrThrow(user, publicId);

    let capacityKg: number | undefined;
    const capacityUnit = input.capacityUnit ?? vehicle.capacityUnit;
    if (input.capacityValue !== undefined || input.capacityUnit !== undefined) {
      if (input.capacityValue === undefined) {
        throw new TransporterDomainError(
          "capacityValue is required when changing capacityUnit.",
          "INVALID_VEHICLE_CAPACITY",
        );
      }
      capacityKg = validateAndNormalizeCapacity({ value: input.capacityValue, unit: capacityUnit });
    }

    const updated = await this.vehicles.update(vehicle.id, {
      ...(input.vehicleType !== undefined ? { vehicleType: input.vehicleType } : {}),
      ...(capacityKg !== undefined ? { capacityKg, capacityUnit } : {}),
      ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
      ...(input.isRefrigerated !== undefined ? { isRefrigerated: input.isRefrigerated } : {}),
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "VEHICLE_UPDATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: {},
      ...meta,
    });

    return toVehiclePublicDTO(updated);
  }

  /** Part G — only AVAILABLE/UNAVAILABLE may be set here, by the owning
   * transporter (or admin). RESERVED/IN_TRANSIT are reserved for Module
   * 16/17's own internal transitions, never a value this endpoint accepts. */
  async updateAvailability(
    user: AuthenticatedUserContext,
    publicId: string,
    status: VehicleAvailabilityStatus,
    meta: RequestMeta,
  ): Promise<VehiclePublicDTO> {
    if (!OWNER_SETTABLE_AVAILABILITY.includes(status)) {
      throw new TransporterDomainError(
        `${status} cannot be set directly; it is reserved for future logistics workflows.`,
        "INVALID_VEHICLE_STATUS_TRANSITION",
      );
    }

    const vehicle = await this.loadOwnedOrThrow(user, publicId);
    const updated = await this.vehicles.updateAvailability(vehicle.id, status);

    await this.audit.record({
      actorUserId: user.id,
      action: "VEHICLE_AVAILABILITY_UPDATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: { from: vehicle.availabilityStatus, to: status },
      ...meta,
    });
    trackEvent("vehicle_availability_updated", user.id, { to: status });

    return toVehiclePublicDTO(updated);
  }

  async updateStatus(
    user: AuthenticatedUserContext,
    publicId: string,
    status: VehicleStatus,
    meta: RequestMeta,
  ): Promise<VehiclePublicDTO> {
    if (status === "SUSPENDED" && user.role !== "ADMIN") {
      throw new TransporterDomainError(
        "Only an administrator can suspend a vehicle.",
        "UNAUTHORIZED_TRANSPORTER_ACCESS",
        403,
      );
    }

    const vehicle = await this.loadOwnedOrThrow(user, publicId);

    if (!ALLOWED_STATUS_TRANSITIONS[vehicle.status].includes(status)) {
      throw new TransporterDomainError(
        `Cannot move a vehicle from ${vehicle.status} to ${status}.`,
        "INVALID_VEHICLE_STATUS_TRANSITION",
        409,
      );
    }

    const updated = await this.vehicles.updateStatus(vehicle.id, status);

    await this.audit.record({
      actorUserId: user.id,
      action: "VEHICLE_STATUS_UPDATED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: { from: vehicle.status, to: status },
      ...meta,
    });

    return toVehiclePublicDTO(updated);
  }

  /** deactivateVehicle (Part L) is a thin, explicit convenience over
   * updateStatus("INACTIVE") — kept as its own method so callers/tests
   * don't have to know the underlying status value to express intent. */
  async deactivateVehicle(
    user: AuthenticatedUserContext,
    publicId: string,
    meta: RequestMeta,
  ): Promise<VehiclePublicDTO> {
    return this.updateStatus(user, publicId, "INACTIVE", meta);
  }

  /** Admin-only (enforced by requireRole("ADMIN") at the router). */
  async verifyVehicle(
    admin: AuthenticatedUserContext,
    publicId: string,
    target: VehicleVerificationStatus,
    meta: RequestMeta,
  ): Promise<VehiclePublicDTO> {
    const vehicle = await this.vehicles.findByPublicId(publicId);
    if (!vehicle) throw new NotFoundError("Vehicle not found.");

    if (!ALLOWED_VERIFICATION_TRANSITIONS[vehicle.verificationStatus].includes(target)) {
      throw new TransporterDomainError(
        `Cannot move a vehicle from ${vehicle.verificationStatus} to ${target}.`,
        "INVALID_VERIFICATION_TRANSITION",
        409,
      );
    }

    const updated = await this.vehicles.updateVerification(vehicle.id, target);

    await this.audit.record({
      actorUserId: admin.id,
      action: target === "VERIFIED" ? "VEHICLE_VERIFIED" : "VEHICLE_REJECTED",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: { from: vehicle.verificationStatus, to: target },
      ...meta,
    });

    if (target === "VERIFIED") trackEvent("vehicle_verified", admin.id, {});

    return toVehiclePublicDTO(updated);
  }
}

export { normalizeRegistrationNumber };
