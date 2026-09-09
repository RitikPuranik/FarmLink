"use client";

import * as React from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Label, FieldError, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passwordSchema } from "@/features/auth/auth.schemas";
import { authApi } from "@/services/authApi";
import { ApiRequestError } from "@/types/api";
import { applyServerFieldErrors } from "@/lib/formErrors";
import { FarmerProfileSection } from "@/components/farmer-profile/FarmerProfileSection";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "validation.required"),
  newPassword: passwordSchema,
});
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

function ChangePasswordForm() {
  const { t } = useI18n();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) });

  async function onSubmit(values: ChangePasswordValues) {
    setServerError(null);
    setSuccess(false);
    try {
      await authApi.changePassword(values.currentPassword, values.newPassword);
      setSuccess(true);
      reset();
    } catch (err) {
      const message = applyServerFieldErrors(err, setError, ["currentPassword", "newPassword"] as const);
      setServerError(message ?? (err instanceof ApiRequestError ? null : t("common.somethingWrong")));
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-medium">Change password</h2>
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        {serverError && <Alert variant="error">{serverError}</Alert>}
        {success && <Alert variant="success">Password changed successfully.</Alert>}
        <div>
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            hasError={!!errors.currentPassword}
            {...register("currentPassword")}
          />
          <FieldError>{errors.currentPassword && t(errors.currentPassword.message!)}</FieldError>
        </div>
        <div>
          <Label htmlFor="newPassword">New password</Label>
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
          Update password
        </Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleLogoutAll() {
    setLoading(true);
    try {
      await authApi.logoutAll();
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="mb-2 text-lg font-medium">Sessions</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Log out of Anndata on every device where you&rsquo;re currently signed in.
      </p>
      {done && <Alert variant="success" className="mb-4">Logged out of all sessions.</Alert>}
      <Button variant="destructive" isLoading={loading} onClick={handleLogoutAll}>
        Log out of all devices
      </Button>
    </Card>
  );
}

function ProfileContent() {
  const { user } = useAuth();
  if (!user) return null;

  // Module 2 (build spec section 33): for FARMER accounts, /profile leads
  // with the farmer/farm/crop/preferences profile — the content this page
  // is named for — and keeps Module 1's account & security tools below it
  // rather than replacing them. Every other role sees exactly what this
  // page showed before Module 2 (unchanged).
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Profile & settings" description="Manage your account, farm details, and security preferences." />
      {user.role === "FARMER" ? (
        <>
          <FarmerProfileSection />
          <h2 className="mb-4 mt-10 text-xl font-semibold">Account & security</h2>
          <ChangePasswordForm />
          <SessionsCard />
        </>
      ) : (
        <>
          <ChangePasswordForm />
          <SessionsCard />
        </>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <ProfileContent />
      </AppShell>
    </ProtectedRoute>
  );
}
