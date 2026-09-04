import { env } from "./env";
import { logger } from "./logger";

// Dependency-free stub, same rationale as sentry.ts: swap in posthog-node's
// real client when the team is ready without touching call sites.

const ALLOWED_EVENTS = new Set([
  "signup_started",
  "signup_completed",
  "login_success",
  "login_failed",
  "logout",
  "password_reset_started",
  "password_reset_completed",
  // Module 2 — Farmer & Farm Profile Management (build spec section 40)
  "profile_started",
  "profile_completed",
  "farm_created",
  "farm_updated",
  "crop_added",
  "crop_removed",
  "primary_crop_selected",
  "fpo_selected",
  "liquidity_preference_set",
  "storage_preference_set",
  // Module 3 — FPO Management & Farmer Aggregation (build spec section 62)
  "fpo_created",
  "membership_requested",
  "membership_approved",
  "membership_rejected",
  "aggregation_created",
  // Module 4 — Crop / Lot Management (build spec section 60/98).
  // "lot_creation_started" is deliberately included for the frontend's own
  // future use (form-entry started) even though nothing in this backend
  // fires it — Module 4 only knows a creation happened once it succeeds.
  "lot_creation_started",
  "lot_created",
  "lot_published",
  "lot_updated",
  "lot_cancelled",
  "lot_viewed",
  // Module 5 — Quality Grading & Produce Assessment (build spec section 63)
  "quality_assessment_created",
  "quality_images_uploaded",
  "quality_ai_analysis_started",
  "quality_ai_analysis_completed",
  "quality_assessment_verified",
  // Modules 6–7 events never include precise coordinates, contacts, or messages.
  "market_snapshot_viewed",
  "market_trends_viewed",
  "market_comparison_viewed",
  "nearby_market_search",
  "market_recommendation_generated",
  "buyer_profile_created",
  "buyer_verified",
  "buyer_demand_created",
  "buyer_demand_activated",
  "buyer_demand_paused",
  "lot_matches_viewed",
  "trade_offer_sent",
  "trade_offer_countered",
  "trade_offer_accepted",
  "trade_offer_rejected",
  // Module 8 — Sell vs Store Decision Engine
  "decision_engine_started",
  "decision_engine_completed",
  "historical_decision_viewed",
  "lot_history_viewed",
  // Module 8 Part 6 — Sell vs Store AI Advisory Layer. Never includes the
  // AI context, provider payload, or advisory text itself — only that a
  // request happened, succeeded, or failed (with an error code).
  "advisory_requested",
  "advisory_success",
  "advisory_failed",
  // Module 9 Part 2 — Warehouse Intelligence. Never includes precise
  // coordinates (BLOCKED_PROPERTY_KEYS below already strips latitude/
  // longitude defensively even if a caller passed them by mistake).
  "warehouse_search",
  "warehouse_availability_viewed",
]);

// Defense in depth: even if a caller accidentally passes a sensitive key in
// properties, it never leaves the process. Module 2 adds farm coordinates
// and free-text address fields — build spec section 40/49 are explicit
// that precise location must never reach analytics.
const BLOCKED_PROPERTY_KEYS = new Set([
  "password",
  "otp",
  "accessToken",
  "refreshToken",
  "token",
  "mobile",
  "email",
  "fullName",
  "latitude",
  "longitude",
  "pincode",
  "village",
]);

export function trackEvent(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
) {
  if (!ALLOWED_EVENTS.has(event)) {
    logger.warn({ event }, "Ignored PostHog event not in the allow-list");
    return;
  }

  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(([key]) => !BLOCKED_PROPERTY_KEYS.has(key)),
  );

  if (!env.POSTHOG_API_KEY) {
    logger.debug({ event, distinctId, properties: safeProperties }, "PostHog disabled — event dropped");
    return;
  }

  // Real implementation: posthogClient.capture({ distinctId, event, properties: safeProperties })
  logger.debug({ event, distinctId, properties: safeProperties }, "PostHog event captured");
}
