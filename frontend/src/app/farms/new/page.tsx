"use client";

import { useRouter } from "next/navigation";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/stat-card";
import { FarmForm } from "@/components/farms/FarmForm";
import { useCreateFarm } from "@/hooks/useFarmerProfile";
import { FarmFormValues } from "@/features/farms/farm.schemas";

function NewFarmContent() {
  const { t } = useI18n();
  const router = useRouter();
  const createFarm = useCreateFarm();

  async function handleSubmit(values: FarmFormValues) {
    await createFarm.mutateAsync({
      name: values.name || undefined,
      village: values.village,
      pincode: values.pincode || undefined,
      stateId: values.stateId,
      districtId: values.districtId,
      talukaId: values.talukaId,
      area: values.area,
      areaUnit: values.areaUnit,
      irrigationType: values.irrigationType,
    });
    router.push("/farms");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("farm.newTitle")} description="Add a new plot of land to your farmer profile." />
      <Card>
        <FarmForm onSubmit={handleSubmit} submitLabel={t("farm.create")} />
      </Card>
    </div>
  );
}

export default function NewFarmPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <NewFarmContent />
    </RoleProtectedPage>
  );
}
