import rateLimit, { Options } from "express-rate-limit";
import { Request, Response } from "express";
import { sendError } from "../common/apiResponse";

function rateLimitedHandler(req: Request, res: Response) {
  sendError(res, 429, "RATE_LIMITED", "Too many requests. Please try again later.");
}

const commonOptions: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitedHandler,
};

// Uses express-rate-limit's in-memory store. That's correct for a single
// backend instance (this module's deployment target). If FarmLink later
// scales to multiple backend instances behind a load balancer, swap the
// `store` option for a Redis-backed store (REDIS_URL is already wired up in
// config/redis.ts) so limits are shared across processes.

/**
 * Login gets the strictest limit (per spec section 35: "Login should have
 * stricter protection than normal APIs") since it's the highest-value
 * target for credential stuffing. Keyed by IP + mobile so one bad actor
 * can't lock out every other farmer sharing the same NAT/IP.
 */
export function loginRateLimiter() {
  return rateLimit({
    ...commonOptions,
    windowMs: 15 * 60 * 1000,
    limit: 8,
    keyGenerator: (req) => `login:${req.ip}:${(req.body?.mobile as string) ?? ""}`,
  });
}

export function registerRateLimiter() {
  return rateLimit({
    ...commonOptions,
    windowMs: 60 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => `register:${req.ip}`,
  });
}

export function passwordResetRateLimiter() {
  return rateLimit({
    ...commonOptions,
    windowMs: 60 * 60 * 1000,
    limit: 6,
    keyGenerator: (req) => `pwreset:${req.ip}`,
  });
}

export function changePasswordRateLimiter() {
  return rateLimit({
    ...commonOptions,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => `pwchange:${req.ip}`,
  });
}
