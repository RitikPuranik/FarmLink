"use client";

import * as React from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/hooks/useAuth";
import { Card, Label, FieldError, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passwordSchema } from "@/features/auth/auth.schemas";
import { authApi } from "@/services/authApi";
import { ApiRequestError } from "@/types/api";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "validation.required"),
  newPassword: passwordSchema,
});
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

function ChangePasswordForm() {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const {
    register,
    handleSubmit,
    reset,
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
      if (err instanceof ApiRequestError && err.fields) {
        setServerError(Object.values(err.fields)[0] ?? err.message);
      } else {
        setServerError(err instanceof ApiRequestError ? err.message : "Something went wrong.");
      }
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
          <FieldError>{errors.currentPassword?.message}</FieldError>
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
          <FieldError>{errors.newPassword?.message}</FieldError>
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
        Log out of FarmLink on every device where you&rsquo;re currently signed in.
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

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Account & security</h1>
      <ChangePasswordForm />
      <SessionsCard />
    </main>
  );
}

export default function ProfilePage() {
  return (
    <ProtectedRoute>
      <TopNav />
      <ProfileContent />
    </ProtectedRoute>
  );
}
