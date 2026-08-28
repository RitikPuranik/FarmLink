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
import { LoginFormValues, loginFormSchema } from "@/features/auth/auth.schemas";
import { ApiRequestError } from "@/types/api";
import { ROLE_HOME_ROUTE } from "@/lib/roleRouting";

export default function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginFormSchema) });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    try {
      const user = await login(values);
      router.push(ROLE_HOME_ROUTE[user.role]);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
    }
  }

  return (
    <AuthLayout
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={
        <span className="text-muted-foreground">
          {t("login.noAccount")}{" "}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("login.createAccount")}
          </Link>
        </span>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} noValidate>
        {serverError && <Alert variant="error">{serverError}</Alert>}

        <div>
          <Label htmlFor="mobile">{t("login.mobile")}</Label>
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
          <Label htmlFor="password">{t("login.password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            hasError={!!errors.password}
            {...register("password")}
          />
          <FieldError>{errors.password && t(errors.password.message!)}</FieldError>
        </div>

        <div className="text-right">
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            {t("login.forgotPassword")}
          </Link>
        </div>

        <Button type="submit" isLoading={isSubmitting}>
          {t("login.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
