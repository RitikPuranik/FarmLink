import { PrismaClient } from "@prisma/client";
import { isProduction } from "../../../config/env";
import { logger } from "../../../config/logger";
import { generateNumericOtp, hashToken } from "../auth.utils";
import { OtpProvider, SendOtpResult, VerifyOtpResult } from "./otpProvider.interface";

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/**
 * Development/demo implementation. Never sends a real SMS. The generated
 * code is only ever surfaced via server logs, and ONLY outside production —
 * this must never leak test OTPs in a deployed environment.
 */
export class MockOtpProvider implements OtpProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async sendOtp(destination: string, purpose: string): Promise<SendOtpResult> {
    const code = generateNumericOtp(6);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    const challenge = await this.prisma.otpChallenge.create({
      data: {
        destination,
        purpose,
        codeHash: hashToken(code),
        expiresAt,
      },
    });

    if (!isProduction) {
      // Development-only convenience so the flow is testable end to end
      // without a paid SMS integration. Never enabled in production.
      logger.info({ destination, purpose, code }, "[MockOtpProvider] Test OTP generated (dev only)");
    }

    return { challengeId: challenge.id, expiresAt };
  }

  async verifyOtp(challengeId: string, code: string): Promise<VerifyOtpResult> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return { success: false, reason: "INVALID" };
    if (challenge.consumedAt) return { success: false, reason: "ALREADY_USED" };
    if (challenge.expiresAt < new Date()) return { success: false, reason: "EXPIRED" };
    if (challenge.attempts >= MAX_ATTEMPTS) return { success: false, reason: "TOO_MANY_ATTEMPTS" };

    const matches = challenge.codeHash === hashToken(code);

    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: {
        attempts: { increment: 1 },
        ...(matches ? { consumedAt: new Date() } : {}),
      },
    });

    return matches ? { success: true } : { success: false, reason: "INVALID" };
  }
}
