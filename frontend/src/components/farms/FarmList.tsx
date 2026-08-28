"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card, Alert } from "@/components/ui/primitives";
import { EmptyState } from "@/components/EmptyState";
import { FarmForm } from "@/components/farms/FarmForm";
import { useDeleteFarm, useUpdateFarm } from "@/hooks/useFarmerProfile";
import { Farm } from "@/types/farmer";
import { FarmFormValues } from "@/features/farms/farm.schemas";
import { ApiRequestError } from "@/types/api";

function areaUnitLabel(t: (key: string) => string, unit: "ACRE" | "HECTARE") {
  return unit === "ACRE" ? t("farm.areaUnit.acre") : t("farm.areaUnit.hectare");
}

function FarmCard({ farm, showName }: { farm: Farm; showName: boolean }) {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const updateFarm = useUpdateFarm();
  const deleteFarm = useDeleteFarm();

  async function handleUpdate(values: FarmFormValues) {
    await updateFarm.mutateAsync({
      id: farm.id,
      input: {
        name: values.name || undefined,
        village: values.village,
        pincode: values.pincode || undefined,
        stateId: values.stateId,
        districtId: values.districtId,
        talukaId: values.talukaId,
        area: values.area,
        areaUnit: values.areaUnit,
        irrigationType: values.irrigationType,
      },
    });
    setIsEditing(false);
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteFarm.mutateAsync(farm.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
    }
  }

  if (isEditing) {
    return (
      <Card>
        <h3 className="mb-4 font-medium">{t("farm.editTitle")}</h3>
        <FarmForm
          initialValues={{
            name: farm.name ?? "",
            village: farm.village,
            pincode: farm.pincode ?? "",
            stateId: farm.state.id,
            districtId: farm.district.id,
            talukaId: farm.taluka.id,
            area: farm.area,
            areaUnit: farm.areaUnit,
            irrigationType: farm.irrigationType,
          }}
          onSubmit={handleUpdate}
          submitLabel={t("common.save")}
          onCancel={() => setIsEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card>
      {deleteError && (
        <Alert variant="error" className="mb-4">
          {deleteError}
        </Alert>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{showName ? farm.name || t("farm.unnamed") : t("farm.myFarm")}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {farm.village}, {farm.taluka.name}, {farm.district.name}, {farm.state.name}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {farm.area} {areaUnitLabel(t, farm.areaUnit)}
            {farm.irrigationType !== "NOT_SPECIFIED" && <> · {t(`irrigation.${farm.irrigationType}`)}</>}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={t("common.edit")}
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("common.delete")}
            disabled={deleteFarm.isPending}
            className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </Card>
  );
}

export function FarmList({ farms }: { farms: Farm[] }) {
  const { t } = useI18n();
  const router = useRouter();

  if (farms.length === 0) {
    return (
      <EmptyState
        message={t("farm.empty")}
        actionLabel={t("farm.addFarm")}
        onAction={() => router.push("/farms/new")}
      />
    );
  }

  return (
    <div className="space-y-3">
      {farms.map((farm) => (
        <FarmCard key={farm.id} farm={farm} showName={farms.length > 1} />
      ))}
      <Link href="/farms/new" className="inline-block text-sm font-medium text-primary hover:underline">
        {t("farm.addAnother")}
      </Link>
    </div>
  );
}
