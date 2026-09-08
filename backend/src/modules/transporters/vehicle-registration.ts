/**
 * Part M — Vehicle Registration Number.
 *
 * Deterministic normalization so "MH12AB1234", "MH-12-AB-1234",
 * "mh12ab1234", and "MH 12 AB 1234" are all recognized as the same
 * registration and cannot be registered twice. This is purely an internal
 * duplicate-prevention normalization — it does NOT validate against any
 * government/RTO registry (Part J/M's documentation rule applies here too).
 */

const ALLOWED_CHARS_PATTERN = /^[A-Z0-9]+$/;

/**
 * Strips whitespace and hyphens, then uppercases. Deterministic and
 * idempotent: normalizeRegistrationNumber(normalizeRegistrationNumber(x)) ===
 * normalizeRegistrationNumber(x).
 */
export function normalizeRegistrationNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export interface RegistrationNumberValidationResult {
  valid: boolean;
  normalized: string;
  reason?: string;
}

/**
 * Light shape validation only (same "input hygiene, not government
 * verification" rule Module 3 applies to FPO registration numbers): a
 * plausible plate is 4-12 alphanumeric characters once normalized. This
 * intentionally does not attempt to validate against India's actual
 * state-code/RTO-code format, which varies and changes over time.
 */
export function validateRegistrationNumber(raw: string): RegistrationNumberValidationResult {
  const normalized = normalizeRegistrationNumber(raw);

  if (normalized.length < 4 || normalized.length > 12) {
    return { valid: false, normalized, reason: "Registration number must be between 4 and 12 characters." };
  }

  if (!ALLOWED_CHARS_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: "Registration number can only contain letters and numbers." };
  }

  return { valid: true, normalized };
}
