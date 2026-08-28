import { z } from "zod";

// Indian mobile numbers: optional +91/0 prefix, then a 10-digit number
// starting 6-9. Normalized down to the bare 10-digit form before storage.
const INDIAN_MOBILE_REGEX = /^(?:\+91|91|0)?([6-9]\d{9})$/;

export function normalizeIndianMobile(raw: string): string {
  const digitsOnly = raw.replace(/[\s-]/g, "");
  const match = digitsOnly.match(INDIAN_MOBILE_REGEX);
  return match ? match[1] : digitsOnly;
}

const mobileSchema = z
  .string({ required_error: "Mobile number is required." })
  .trim()
  .min(1, "Mobile number is required.")
  .refine((val) => INDIAN_MOBILE_REGEX.test(val.replace(/[\s-]/g, "")), {
    message: "Enter a valid Indian mobile number.",
  })
  .transform(normalizeIndianMobile);

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.");

const optionalEmailSchema = z
  .union([emailSchema, z.literal(""), z.undefined()])
  .transform((val) => (val ? val : undefined));

// Minimum secure length + a small amount of composition guidance. Kept
// deliberately simple/testable rather than an exhaustive policy engine.
const passwordSchema = z
  .string({ required_error: "Password is required." })
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password is too long.")
  .refine((val) => /[a-z]/.test(val) && /[A-Z]/.test(val) && /\d/.test(val), {
    message: "Password must include uppercase, lowercase, and a number.",
  });

const fullNameSchema = z
  .string({ required_error: "Full name is required." })
  .trim()
  .min(2, "Enter your full name.")
  .max(120, "Name is too long.")
  .refine((val) => /^[\p{L}][\p{L}\s.'-]*$/u.test(val), {
    message: "Name contains invalid characters.",
  });

const languageSchema = z.enum(["en", "hi", "mr"], {
  errorMap: () => ({ message: "Unsupported language." }),
});

export const registerSchema = z.object({
  fullName: fullNameSchema,
  mobile: mobileSchema,
  email: optionalEmailSchema,
  password: passwordSchema,
  preferredLanguage: languageSchema.default("en"),
  // `role` is intentionally NOT accepted here. If a client sends one, the
  // route-level strict parsing below rejects the whole request rather than
  // silently ignoring an attempted privilege escalation.
});

// Registration requests are parsed with this stricter schema at the route
// boundary so an unexpected `role` field fails loudly (see section 24 of the
// build spec: never silently accept a client-supplied role).
export const registerRequestSchema = registerSchema.strict();

export const loginSchema = z.object({
  mobile: mobileSchema,
  password: z.string({ required_error: "Password is required." }).min(1, "Password is required."),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: passwordSchema,
  })
  .refine((val) => val.currentPassword !== val.newPassword, {
    message: "New password must be different from the current password.",
    path: ["newPassword"],
  });

export const forgotPasswordSchema = z.object({
  mobile: mobileSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required."),
  newPassword: passwordSchema,
});

export type RegisterRequestBody = z.infer<typeof registerRequestSchema>;
export type LoginRequestBody = z.infer<typeof loginSchema>;
export type ChangePasswordRequestBody = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordRequestBody = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordRequestBody = z.infer<typeof resetPasswordSchema>;
