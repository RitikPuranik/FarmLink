import { z } from "zod";

const INDIAN_MOBILE_REGEX = /^(?:\+91|91|0)?([6-9]\d{9})$/;

export const mobileSchema = z
  .string()
  .trim()
  .min(1, "validation.required")
  .refine((val) => INDIAN_MOBILE_REGEX.test(val.replace(/[\s-]/g, "")), "validation.mobile");

export const passwordSchema = z
  .string()
  .min(8, "validation.password")
  .max(128, "validation.password")
  .refine((val) => /[a-z]/.test(val) && /[A-Z]/.test(val) && /\d/.test(val), "validation.password");

export const loginFormSchema = z.object({
  mobile: mobileSchema,
  password: z.string().min(1, "validation.required"),
});
export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const registerFormSchema = z
  .object({
    fullName: z.string().trim().min(2, "validation.fullName"),
    mobile: mobileSchema,
    email: z.union([z.string().email("validation.email"), z.literal("")]).optional(),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "validation.required"),
    preferredLanguage: z.enum(["en", "hi", "mr"]),
  })
  .refine((val) => val.password === val.confirmPassword, {
    message: "register.confirmPasswordMismatch",
    path: ["confirmPassword"],
  });
export type RegisterFormValues = z.infer<typeof registerFormSchema>;

export const forgotPasswordFormSchema = z.object({
  mobile: mobileSchema,
});
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;

export const resetPasswordFormSchema = z.object({
  token: z.string().min(1, "validation.required"),
  newPassword: passwordSchema,
});
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;
