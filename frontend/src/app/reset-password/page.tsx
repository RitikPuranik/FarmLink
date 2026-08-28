"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useI18n } from "@/i18n/I18nProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, FieldError, Alert } from "@/components/ui/primitives";
import { ResetPasswordFormValues, resetPasswordFormSchema } from "@/features/auth/auth.schemas";
import { authApi } from "@/services/authApi";
import { ApiRequestError } from "@/types/api";

function ResetPasswordForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { token: searchParams.get("token") ?? "" },
  });

  async function onSubmit(values: ResetPasswordFormValues) {
    setServerError(null);
    try {
      await authApi.resetPassword(values.token, values.newPassword);
      router.push("/login?reset=1");
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
      title={t("resetPassword.title")}
      subtitle={t("resetPassword.subtitle")}
      footer={
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("forgotPassword.backToLogin")}
        </Link>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        {serverError && <Alert variant="error">{serverError}</Alert>}

        <div>
          <Label htmlFor="token">{t("resetPassword.token")}</Label>
          <Input id="token" hasError={!!errors.token} {...register("token")} />
          <FieldError>{errors.token && t(errors.token.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="newPassword">{t("resetPassword.newPassword")}</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            hasError={!!errors.newPassword}
            {...register("newPassword")}
          />
          <FieldError>{errors.newPassword && t(errors.newPassword.message!)}</FieldError>
        </div>

        <Button type="submit" isLoading={isSubmitting}>
          {t("resetPassword.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}
