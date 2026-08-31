import { CropLotStatus } from "@prisma/client";
import { ConflictError } from "../../common/errors";

/**
 * The full state machine (build spec section 8/27/82) — kept as one table
 * even though only DRAFT->AVAILABLE (publish) and {DRAFT,AVAILABLE}-
 * >CANCELLED (cancel) are reachable through a route today. The remaining
 * edges exist so future modules (reservation, warehouse, logistics,
 * delivery, payment) reuse this same validated transition instead of each
 * inventing their own status-legality check — and so validateTransition()
 * below can already reject e.g. DRAFT -> COMPLETED (build spec section 82)
 * even before anything calls that edge in practice.
 */
const ALLOWED_TRANSITIONS: Record<CropLotStatus, CropLotStatus[]> = {
  DRAFT: ["AVAILABLE", "CANCELLED"],
  AVAILABLE: ["PARTIALLY_COMMITTED", "COMMITTED", "STORED", "CANCELLED"],
  PARTIALLY_COMMITTED: ["COMMITTED"],
  COMMITTED: ["IN_TRANSACTION"],
  STORED: [],
  IN_TRANSACTION: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

// Build spec section 75: normal cancellation is blocked once a lot has
// entered a transaction-committed state.
export const CANCELLABLE_STATUSES: CropLotStatus[] = ["DRAFT", "AVAILABLE"];

export class LotStatusService {
  isTransitionAllowed(from: CropLotStatus, to: CropLotStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /** Throws a friendly ConflictError instead of letting an illegal
   * transition reach the database at all (build spec section 27: "Reject
   * illegal transitions" with "clear errors" per section 82). */
  validateTransition(from: CropLotStatus, to: CropLotStatus): void {
    if (!this.isTransitionAllowed(from, to)) {
      throw new ConflictError(`A lot cannot move from ${from} to ${to}.`);
    }
  }
}
