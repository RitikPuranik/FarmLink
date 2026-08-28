"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/primitives";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { ProfileCompletionCard } from "@/components/farmer-profile/ProfileCompletionCard";
import { FarmList } from "@/components/farms/FarmList";
import { CropManager } from "@/components/crops/CropManager";
import { PreferencesForm } from "@/components/farmer-profile/PreferencesForm";
import { ApiRequestError } from "@/types/api";

function PersonalInfoCard() {
  const { t } = useI18n();
  const { user } = useAuth();
  if (!user) return null;

  return (
    <Card>
      <h2 className="mb-4 text-lg font-medium">{t("farmerProfile.personal")}</h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">{t("farmerProfile.name")}</dt>
          <dd className="font-medium">{user.fullName}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("farmerProfile.mobile")}</dt>
          <dd className="font-medium">{user.mobile}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("farmerProfile.email")}</dt>
          <dd className="font-medium">{user.email ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("farmerProfile.language")}</dt>
          <dd className="font-medium">{t(`language.${user.preferredLanguage}`)}</dd>
        </div>
      </dl>
    </Card>
  );
}

export function FarmerProfileSection() {
  const { t } = useI18n();
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("farmerProfile.title")}</h1>

      <ProfileCompletionCard completion={data.completion} />

      <PersonalInfoCard />

      <Card>
        <h2 className="mb-1 text-lg font-medium">{t("farm.sectionTitle")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t("farm.sectionSubtitle")}</p>
        <FarmList farms={data.farms} />
      </Card>

      <CropManager crops={data.crops} farms={data.farms} />

      <PreferencesForm profile={data.profile} farms={data.farms} />
    </div>
  );
}
