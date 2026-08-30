/**
 * Build spec section 67: "If notifications are not yet implemented, create
 * clean service hooks/interfaces rather than inventing a second
 * notification platform." Module 1/2 have no notification system to plug
 * into (no queue, no Socket.IO/BullMQ configured in this project) — this
 * interface is the seam a real implementation drops into later without
 * touching any Module 3 service call site.
 */
export type FpoNotificationEvent =
  | { type: "MEMBERSHIP_REQUESTED"; membershipId: string; fpoId: string; farmerUserId: string }
  | { type: "MEMBERSHIP_APPROVED"; membershipId: string; fpoId: string; farmerUserId: string }
  | { type: "MEMBERSHIP_REJECTED"; membershipId: string; fpoId: string; farmerUserId: string; reason?: string | null }
  | { type: "MEMBER_REMOVED"; membershipId: string; fpoId: string; farmerUserId: string }
  | { type: "FPO_VERIFICATION_COMPLETED"; fpoId: string; verificationStatus: string };

export interface FpoNotificationHooks {
  notify(event: FpoNotificationEvent): Promise<void>;
}

/** No-op default — see the module doc comment above. */
export class NoopFpoNotificationHooks implements FpoNotificationHooks {
  async notify(): Promise<void> {
    // Intentionally empty until a real notification channel exists.
  }
}
