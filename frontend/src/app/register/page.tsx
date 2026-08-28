"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, FieldError, Alert } from "@/components/ui/primitives";
import { RegisterFormValues, registerFormSchema } from "@/features/auth/auth.schemas";
import { ApiRequestError } from "@/types/api";

const LANGUAGE_OPTIONS: { value: "en" | "hi" | "mr"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "mr", label: "मराठी (Marathi)" },
];

export default function RegisterPage() {
  const { t } = useI18n();
  const { register: registerUser } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { preferredLanguage: "en" },
  });

  async function onSubmit(values: RegisterFormValues) {
    setServerError(null);
    try {
      await registerUser({
        fullName: values.fullName,
        mobile: values.mobile,
        email: values.email || undefined,
        password: values.password,
        preferredLanguage: values.preferredLanguage,
      });
      router.push("/login?registered=1");
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields) {
        setServerError(Object.values(err.fields)[0] ?? err.message);
      } else {
        setServerError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
      }
    }
  }

  return (
    <AuthLayout
      title={t("register.title")}
      subtitle={t("register.subtitle")}
      footer={
        <span className="text-muted-foreground">
          {t("register.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("register.login")}
          </Link>
        </span>
      }
    >
      {/* Deliberately no role field anywhere in this form — public
          registration always creates a FARMER account server-side. */}
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        {serverError && <Alert variant="error">{serverError}</Alert>}

        <div>
          <Label htmlFor="fullName">{t("register.fullName")}</Label>
          <Input id="fullName" autoComplete="name" hasError={!!errors.fullName} {...register("fullName")} />
          <FieldError>{errors.fullName && t(errors.fullName.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="mobile">{t("register.mobile")}</Label>
          <Input
            id="mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            hasError={!!errors.mobile}
            {...register("mobile")}
          />
          <FieldError>{errors.mobile && t(errors.mobile.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="email">{t("register.email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            hasError={!!errors.email}
            {...register("email")}
          />
          <FieldError>{errors.email && t(errors.email.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="password">{t("register.password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.password}
            {...register("password")}
          />
          <FieldError>{errors.password && t(errors.password.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="confirmPassword">{t("register.confirmPassword")}</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          <FieldError>{errors.confirmPassword && t(errors.confirmPassword.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="preferredLanguage">{t("register.preferredLanguage")}</Label>
          <select
            id="preferredLanguage"
            className="flex h-14 w-full rounded-lg border border-input bg-card px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register("preferredLanguage")}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" isLoading={isSubmitting}>
          {t("register.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
