import pino from "pino";
import { isProduction, isTest } from "./env";

// Fields that must never reach logs, regardless of where they appear in the
// payload. This list backs both the HTTP logger redaction and any manual
// logger.info/error calls in the codebase.
const REDACTED_PATHS = [
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.confirmPassword",
  "req.body.otp",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.password",
  "*.passwordHash",
  "*.tokenHash",
  "*.otp",
  "*.otpCode",
  "*.jwtSecret",
  "*.refreshToken",
  "*.accessToken",
];

export const logger = pino({
  level: isTest ? "silent" : isProduction ? "info" : "debug",
  redact: {
    paths: REDACTED_PATHS,
    censor: "[REDACTED]",
  },
});
