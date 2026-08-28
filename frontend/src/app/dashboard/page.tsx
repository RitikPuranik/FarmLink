"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { Card, Alert } from "@/components/ui/primitives";
import Link from "next/link";

function DashboardContent() {
  const { user } = useAuth();
  const { t } = useI18n();

  if (!user) return null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("dashboard.welcome", { name: user.fullName })}</h1>
      <p className="mt-1 text-muted-foreground">{t("dashboard.role.farmer")}</p>

      {user.accountStatus === "PENDING_VERIFICATION" && (
        <Alert variant="info" className="mt-6">
          {t("dashboard.accountPending")}
        </Alert>
      )}

      <Card className="mt-6">
        <h2 className="mb-4 text-lg font-medium">Account</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Mobile</dt>
            <dd className="font-medium">{user.mobile}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Email</dt>
            <dd className="font-medium">{user.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Role</dt>
            <dd className="font-medium">{user.role}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd className="font-medium">{user.accountStatus}</dd>
          </div>
        </dl>
        <Link
          href="/profile"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          Manage account & security →
        </Link>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground">
        Farms, crops, and market prices are not part of Module 1 yet — this dashboard is a
        placeholder for those future modules.
      </p>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <DashboardContent />
    </RoleProtectedPage>
  );
}
