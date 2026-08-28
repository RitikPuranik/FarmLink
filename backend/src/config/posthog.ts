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
]);

// Defense in depth: even if a caller accidentally passes a sensitive key in
// properties, it never leaves the process.
const BLOCKED_PROPERTY_KEYS = new Set([
  "password",
  "otp",
  "accessToken",
  "refreshToken",
  "token",
  "mobile",
  "email",
  "fullName",
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
