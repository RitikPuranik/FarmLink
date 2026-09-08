
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, FieldError, Alert } from "@/components/ui/primitives";
import {
  LoginFormValues,
  loginFormSchema,
} from "@/features/auth/auth.schemas";
import { ApiRequestError } from "@/types/api";
import { ROLE_HOME_ROUTE } from "@/lib/roleRouting";

export default function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuth();
  const router = useRouter();

  const [serverError, setServerError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      mobile: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);

    try {
      const user = await login(values);

      router.push(ROLE_HOME_ROUTE[user.role]);
    } catch (err) {
      setServerError(
        err instanceof ApiRequestError
          ? err.message
          : t("common.networkError")
      );
    }
  }

  return (
    <AuthLayout
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={
        <span className="text-muted-foreground">
          {t("login.noAccount")}{" "}
          <Link
            href="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("login.createAccount")}
          </Link>
        </span>
      }
    >
      <form
        className="space-y-4"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        {serverError && <Alert variant="error">{serverError}</Alert>}

        {/* Mobile */}
        <div className="space-y-1.5">
          <Label htmlFor="mobile">{t("login.mobile")}</Label>

          <Input
            id="mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10-digit mobile number"
            hasError={!!errors.mobile}
            {...register("mobile")}
          />

          <FieldError>
            {errors.mobile && t(errors.mobile.message!)}
          </FieldError>
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("login.password")}</Label>

          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              hasError={!!errors.password}
              className="pr-11"
              {...register("password")}
            />

            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={
                showPassword ? "Hide password" : "Show password"
              }
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>

          <FieldError>
            {errors.password && t(errors.password.message!)}
          </FieldError>
        </div>

        {/* Forgot password */}
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("login.forgotPassword")}
          </Link>
        </div>

        {/* Submit */}
        <Button
          type="submit"
          isLoading={isSubmitting}
          className="w-full"
        >
          <span>{t("login.submit")}</span>
          {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </form>
    </AuthLayout>
  );
}

