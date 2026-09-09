"use client";

import { useRouter } from "next/navigation";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useI18n } from "@/i18n/I18nProvider";
import { Card } from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/stat-card";
import { FarmForm } from "@/components/farms/FarmForm";
import { FeatureTour } from "@/components/FeatureTour";
import { useCreateFarm, useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { FarmFormValues } from "@/features/farms/farm.schemas";

function NewFarmContent() {
  const { t } = useI18n();
  const router = useRouter();
  const createFarm = useCreateFarm();
  const profileQuery = useFarmerProfileQuery();

  // Only show the walkthrough the very first time — once the farmer already
  // has at least one farm, they don't need it pointed out to them again.
  const isFirstFarm = (profileQuery.data?.farms.length ?? 0) === 0;

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
      <FeatureTour
        tourId="add-farm"
        enabled={isFirstFarm}
        steps={[
          {
            target: "[data-tour='farm-name-field']",
            title: "Name your farm",
            text: "Give this plot a name you'll recognise later — e.g. 'North field' or 'Near the well'. This is optional.",
          },
          {
            target: "[data-tour='farm-state-field']",
            title: "Pick the state first",
            text: "Choosing the state unlocks the district list, and choosing a district unlocks the taluka list — fill these in top to bottom.",
          },
          {
            target: "[data-tour='farm-area-field']",
            title: "Add the area",
            text: "Enter how big this farm is, and pick acres or hectares next to it — whichever you're used to.",
          },
          {
            target: "[data-tour='farm-submit-button']",
            title: "Save your farm",
            text: "Once everything looks right, tap here to add the farm to your profile. You can always edit these details later.",
          },
        ]}
      />
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

