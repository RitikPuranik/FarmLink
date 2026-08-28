import {
  generateNumericOtp,
  generateSecureToken,
  hashPassword,
  hashToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "../../src/modules/auth/auth.utils";

describe("password hashing", () => {
  it("hashes a password and verifies the correct plaintext", async () => {
    const hash = await hashPassword("CorrectHorse1");
    expect(hash).not.toEqual("CorrectHorse1");
    expect(await verifyPassword(hash, "CorrectHorse1")).toBe(true);
  });

  it("rejects an incorrect plaintext", async () => {
    const hash = await hashPassword("CorrectHorse1");
    expect(await verifyPassword(hash, "WrongPassword1")).toBe(false);
  });

  it("never stores the plaintext password inside the hash", async () => {
    const hash = await hashPassword("SuperSecret99");
    expect(hash).not.toContain("SuperSecret99");
  });

  it("produces a different hash each time (unique salts)", async () => {
    const [a, b] = await Promise.all([hashPassword("SamePassword1"), hashPassword("SamePassword1")]);
    expect(a).not.toEqual(b);
  });

  it("treats a malformed hash as a failed verification, not a crash", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
  });
});

describe("secure token generation", () => {
  it("generates tokens of sufficient length and uniqueness", () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(32);
  });

  it("hashToken is deterministic for the same input", () => {
    const token = generateSecureToken();
    expect(hashToken(token)).toEqual(hashToken(token));
  });

  it("hashToken output never equals the raw token", () => {
    const token = generateSecureToken();
    expect(hashToken(token)).not.toEqual(token);
  });

  it("generates 6-digit numeric OTPs", () => {
    for (let i = 0; i < 20; i++) {
      const otp = generateNumericOtp(6);
      expect(otp).toMatch(/^\d{6}$/);
    }
  });
});

describe("JWT access tokens", () => {
  const user = { id: "user-1", publicId: "public-1", role: "FARMER" as const };

  it("signs and verifies a valid access token", () => {
    const token = signAccessToken(user);
    const payload = verifyAccessToken(token);
    expect(payload.sub).toEqual(user.id);
    expect(payload.role).toEqual("FARMER");
  });

  it("rejects a tampered token", () => {
    const token = signAccessToken(user);
    const tampered = token.slice(0, -2) + "xx";
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it("never embeds the password hash or any secret in the payload", () => {
    const token = signAccessToken(user);
    const [, payloadB64] = token.split(".");
    const decoded = Buffer.from(payloadB64, "base64url").toString("utf8");
    expect(decoded.toLowerCase()).not.toContain("password");
  });
});
