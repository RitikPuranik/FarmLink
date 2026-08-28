import {
  loginSchema,
  normalizeIndianMobile,
  registerRequestSchema,
} from "../../src/modules/auth/auth.schemas";

describe("mobile validation", () => {
  it.each(["9876543210", "+919876543210", "919876543210", "09876543210"])(
    "accepts and normalizes %s",
    (input) => {
      expect(normalizeIndianMobile(input)).toEqual("9876543210");
    },
  );

  it.each(["12345", "5876543210", "98765432", "abcdefghij", ""])(
    "rejects invalid mobile number: %p",
    (mobile) => {
      const result = registerRequestSchema.safeParse({
        fullName: "Ramesh Patil",
        mobile,
        password: "SecurePassword123",
        preferredLanguage: "en",
      });
      expect(result.success).toBe(false);
    },
  );
});

describe("registerRequestSchema", () => {
  const validPayload = {
    fullName: "Ramesh Patil",
    mobile: "9876543210",
    email: "ramesh@example.com",
    password: "SecurePassword123",
    preferredLanguage: "mr",
  };

  it("accepts a valid registration payload", () => {
    const result = registerRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects a payload that tries to set role — the #1 privilege-escalation vector", () => {
    const result = registerRequestSchema.safeParse({ ...validPayload, role: "ADMIN" });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with role=FARMER too — role is never a client-supplied field", () => {
    const result = registerRequestSchema.safeParse({ ...validPayload, role: "FARMER" });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported language code", () => {
    const result = registerRequestSchema.safeParse({ ...validPayload, preferredLanguage: "fr" });
    expect(result.success).toBe(false);
  });

  it("allows registration without an email (optional)", () => {
    const { email, ...withoutEmail } = validPayload;
    void email;
    const result = registerRequestSchema.safeParse(withoutEmail);
    expect(result.success).toBe(true);
  });

  it("rejects a weak password", () => {
    const result = registerRequestSchema.safeParse({ ...validPayload, password: "weak" });
    expect(result.success).toBe(false);
  });

  it("rejects a password with no uppercase/number complexity", () => {
    const result = registerRequestSchema.safeParse({ ...validPayload, password: "alllowercase" });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts mobile + password", () => {
    const result = loginSchema.safeParse({ mobile: "9876543210", password: "anything" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing password", () => {
    const result = loginSchema.safeParse({ mobile: "9876543210" });
    expect(result.success).toBe(false);
  });
});
