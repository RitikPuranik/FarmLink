import * as Sentry from "@sentry/node";
import { env } from "./env";
import { logger } from "./logger";

let initialized = false;

export function initSentry() {
  if (!env.SENTRY_DSN) {
    logger.info("SENTRY_DSN not set — Sentry error monitoring is disabled.");
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV || "development",
  });

  initialized = true;

  logger.info(
    { environment: env.NODE_ENV },
    "Sentry initialized",
  );
}

const SENSITIVE_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "passwordHash",
  "otp",
  "tokenHash",
  "refreshToken",
  "accessToken",
  "authorization",
  "cookie",
]);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEYS.has(k) ? "[REDACTED]" : scrub(v),
      ]),
    );
  }

  return value;
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
) {
  const scrubbedContext = context ? scrub(context) : undefined;

  if (!initialized) {
    logger.error(
      { err: error, context: scrubbedContext },
      "Unhandled exception",
    );
    return;
  }

  Sentry.captureException(error, {
    extra: scrubbedContext as Record<string, unknown> | undefined,
  });



  logger.error(
    { err: error, context: scrubbedContext },
    "Captured exception (Sentry)",
  );
}