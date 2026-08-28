export interface SendOtpResult {
  challengeId: string;
  expiresAt: Date;
}

export interface VerifyOtpResult {
  success: boolean;
  reason?: "EXPIRED" | "INVALID" | "ALREADY_USED" | "TOO_MANY_ATTEMPTS";
}

/**
 * Abstraction over "send a one-time code to a destination and verify it
 * later". Module 1 ships only MockOtpProvider — no real SMS spend yet — but
 * every future module (phone verification, 2FA, buyer/transporter
 * onboarding) can code against this interface and swap in a real provider
 * later without touching call sites.
 */
export interface OtpProvider {
  sendOtp(destination: string, purpose: string): Promise<SendOtpResult>;
  verifyOtp(challengeId: string, code: string): Promise<VerifyOtpResult>;
}
