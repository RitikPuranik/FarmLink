import { PrismaClient } from "@prisma/client";
import { NormalizedWarehouseRecord } from "./warehouse-normalization.service";

export type DuplicateMatchState = "MATCHED" | "POSSIBLE_DUPLICATE" | "UNMATCHED";

export interface DuplicateDetectionResult {
  state: DuplicateMatchState;
  /** The existing warehouse id involved, for both MATCHED (safe to attach
   * a new source reference to) and POSSIBLE_DUPLICATE (a candidate to
   * report, never to merge into automatically). Null for UNMATCHED. */
  warehouseId: string | null;
  reason: string;
}

/**
 * Conservative, deterministic duplicate detection (Part 11 of the
 * ingestion spec). Only two signals are strong enough to auto-link a new
 * external record to an existing warehouse (MATCHED): identical
 * coordinates, or an identical name within the same state/district — both
 * mirror the same "same normalized name + district + state" identity
 * Mandi already trusts elsewhere in this schema
 * (@@unique([source, normalizedName, district, state]) on the Mandi
 * model). Anything weaker (name matches but location differs, or only the
 * pincode matches) is reported as POSSIBLE_DUPLICATE and left for a human
 * to reconcile — warehouse-sync.service.ts never merges a
 * POSSIBLE_DUPLICATE into the candidate it names; it still creates its own
 * independent Warehouse row and simply flags the candidate in the sync
 * summary (Part 11: "never automatically merge uncertain matches").
 */
export class WarehouseDuplicateDetectionService {
  constructor(private readonly prisma: PrismaClient) {}

  async detect(record: NormalizedWarehouseRecord): Promise<DuplicateDetectionResult> {
    const { latitude, longitude } = record.location;
    if (latitude !== null && longitude !== null) {
      const byCoordinates = await this.prisma.warehouse.findFirst({
        where: { latitude, longitude },
        select: { id: true },
      });
      if (byCoordinates) return { state: "MATCHED", warehouseId: byCoordinates.id, reason: "EXACT_COORDINATES" };
    }

    if (record.name && record.location.state && record.location.district) {
      const byNameAndLocation = await this.prisma.warehouse.findFirst({
        where: {
          name: { equals: record.name, mode: "insensitive" },
          state: { equals: record.location.state, mode: "insensitive" },
          district: { equals: record.location.district, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (byNameAndLocation) {
        return { state: "MATCHED", warehouseId: byNameAndLocation.id, reason: "NAME_STATE_DISTRICT" };
      }
    }

    if (record.name) {
      const byNameOnly = await this.prisma.warehouse.findFirst({
        where: { name: { equals: record.name, mode: "insensitive" } },
        select: { id: true },
      });
      if (byNameOnly) return { state: "POSSIBLE_DUPLICATE", warehouseId: byNameOnly.id, reason: "NAME_ONLY" };
    }

    if (record.location.pincode) {
      const byPincode = await this.prisma.warehouse.findFirst({
        where: { pincode: record.location.pincode },
        select: { id: true },
      });
      if (byPincode) return { state: "POSSIBLE_DUPLICATE", warehouseId: byPincode.id, reason: "PINCODE_ONLY" };
    }

    return { state: "UNMATCHED", warehouseId: null, reason: "NO_CANDIDATE" };
  }
}
