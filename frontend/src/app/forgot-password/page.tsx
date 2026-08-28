"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useI18n } from "@/i18n/I18nProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, FieldError, Alert } from "@/components/ui/primitives";
import { ForgotPasswordFormValues, forgotPasswordFormSchema } from "@/features/auth/auth.schemas";
import { authApi } from "@/services/authApi";
import { ApiRequestError } from "@/types/api";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [submitted, setSubmitted] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({ resolver: zodResolver(forgotPasswordFormSchema) });

  async function onSubmit(values: ForgotPasswordFormValues) {
    setServerError(null);
    try {
      await authApi.forgotPassword(values.mobile);
      // Always the same UI outcome regardless of whether the account
      // exists — the backend already guarantees this at the API level.
      setSubmitted(true);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
    }
  }

  return (
    <AuthLayout
      title={t("forgotPassword.title")}
      subtitle={t("forgotPassword.subtitle")}
      footer={
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("forgotPassword.backToLogin")}
        </Link>
      }
    >
      {submitted ? (
        <Alert variant="success">{t("forgotPassword.genericSuccess")}</Alert>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
          {serverError && <Alert variant="error">{serverError}</Alert>}
          <div>
            <Label htmlFor="mobile">{t("forgotPassword.mobile")}</Label>
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
          <Button type="submit" isLoading={isSubmitting}>
            {t("forgotPassword.submit")}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
