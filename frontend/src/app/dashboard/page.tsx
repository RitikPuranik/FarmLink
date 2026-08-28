"use client";

import Link from "next/link";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { Card, Alert } from "@/components/ui/primitives";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { ProfileCompletionCard } from "@/components/farmer-profile/ProfileCompletionCard";
import { ApiRequestError } from "@/types/api";

function FarmerSummaryCard() {
  const { t, language } = useI18n();
  const { data, isLoading, isError, error, refetch } = useFarmerProfileQuery();

  if (isLoading) return <LoadingBlock label={t("common.loading")} />;

  if (isError || !data) {
    return (
      <ErrorBlock
        message={error instanceof ApiRequestError ? error.message : t("common.networkError")}
        onRetry={() => refetch()}
        retryLabel={t("common.tryAgain")}
      />
    );
  }

  const primaryFarm = data.farms[0];
  const primaryCrops = data.crops.filter((c) => c.isPrimary);

  return (
    <div className="mt-6 space-y-6">
      <ProfileCompletionCard completion={data.completion} showLinkToProfile />

      <Card>
        <h2 className="mb-4 text-lg font-medium">{t("dashboard.farmSummary")}</h2>

        {!primaryFarm ? (
          <EmptyState
            message={t("farm.empty")}
            actionLabel={t("farm.addFarm")}
            onAction={() => (window.location.href = "/farms/new")}
          />
        ) : (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">{t("dashboard.farm")}</dt>
              <dd className="font-medium">
                {primaryFarm.district.name}, {primaryFarm.state.name}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("dashboard.area")}</dt>
              <dd className="font-medium">
                {primaryFarm.area}{" "}
                {primaryFarm.areaUnit === "ACRE" ? t("farm.areaUnit.acre") : t("farm.areaUnit.hectare")}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("dashboard.primaryCrops")}</dt>
              <dd className="font-medium">
                {primaryCrops.length > 0
                  ? primaryCrops
                      .map((c) => (language === "en" ? c.crop.name : c.crop.translations[language] ?? c.crop.name))
                      .join(", ")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("dashboard.fpo")}</dt>
              <dd className="font-medium">{data.profile.fpo?.name ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">{t("dashboard.sellingPreference")}</dt>
              <dd className="font-medium">
                {data.profile.liquidityPreference
                  ? t(`preferences.liquidity.${data.profile.liquidityPreference}`)
                  : "—"}
              </dd>
            </div>
          </dl>
        )}

        <Link href="/profile" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          {t("dashboard.manageProfile")} →
        </Link>
      </Card>
    </div>
  );
}

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

      <FarmerSummaryCard />

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
        Market prices, buyer matching, and logistics are not part of this module yet.
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
