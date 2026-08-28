"use client";

import { useRouter } from "next/navigation";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ui/primitives";
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
    router.push("/profile");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t("farm.newTitle")}</h1>
      <Card>
        <FarmForm onSubmit={handleSubmit} submitLabel={t("farm.create")} />
      </Card>
    </main>
  );
}

export default function NewFarmPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <NewFarmContent />
    </RoleProtectedPage>
  );
}
