"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sprout, Star, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card, Label, FieldError, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { useCropsQuery } from "@/hooks/useReferenceData";
import { useAddFarmerCrop, useDeleteFarmerCrop, useUpdateFarmerCrop } from "@/hooks/useFarmerProfile";
import { cropFormSchema, CropFormValues } from "@/features/farms/farm.schemas";
import { Farm, FarmerCrop } from "@/types/farmer";
import { ApiRequestError } from "@/types/api";

function localizedCropName(crop: FarmerCrop["crop"], language: "en" | "hi" | "mr") {
  if (language === "en") return crop.name;
  return crop.translations[language] ?? crop.name;
}

function CropRow({ crop, farms }: { crop: FarmerCrop; farms: Farm[] }) {
  const { t, language } = useI18n();
  const [error, setError] = React.useState<string | null>(null);
  const updateCrop = useUpdateFarmerCrop();
  const deleteCrop = useDeleteFarmerCrop();
  const farm = farms.find((f) => f.id === crop.farmId);

  async function handleSetPrimary() {
    setError(null);
    try {
      await updateCrop.mutateAsync({ id: crop.id, input: { isPrimary: true } });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
    }
  }

  async function handleRemove() {
    setError(null);
    try {
      await deleteCrop.mutateAsync(crop.id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex gap-3">
        <Sprout className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="font-medium">
            {localizedCropName(crop.crop, language)}
            {crop.isPrimary && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Star className="h-3 w-3" aria-hidden />
                {t("crop.primary")}
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {crop.area} {crop.areaUnit === "ACRE" ? t("farm.areaUnit.acre") : t("farm.areaUnit.hectare")}
            {farm && farms.length > 1 && <> · {farm.name || t("farm.myFarm")}</>}
          </p>
          {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {!crop.isPrimary && (
          <button
            type="button"
            aria-label={t("crop.setPrimary")}
            disabled={updateCrop.isPending}
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
            onClick={handleSetPrimary}
          >
            <Star className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          aria-label={t("common.delete")}
          disabled={deleteCrop.isPending}
          className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          onClick={handleRemove}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function AddCropForm({ farms }: { farms: Farm[] }) {
  const { t, language } = useI18n();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const cropsQuery = useCropsQuery();
  const addCrop = useAddFarmerCrop();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CropFormValues>({
    resolver: zodResolver(cropFormSchema),
    defaultValues: { farmId: farms.length === 1 ? farms[0].id : "", areaUnit: "ACRE" },
  });

  async function onSubmit(values: CropFormValues) {
    setServerError(null);
    try {
      await addCrop.mutateAsync({
        farmId: values.farmId,
        cropId: values.cropId,
        area: values.area,
        areaUnit: values.areaUnit,
        typicalYield: values.typicalYield && !Number.isNaN(values.typicalYield) ? values.typicalYield : undefined,
        yieldUnit: values.yieldUnit || undefined,
        isPrimary: values.isPrimary,
      });
      reset({ farmId: farms.length === 1 ? farms[0].id : "", areaUnit: "ACRE" });
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields) {
        setServerError(Object.values(err.fields)[0] ?? err.message);
      } else {
        setServerError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
      }
    }
  }

  return (
    <form className="mt-4 space-y-4 border-t border-border pt-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      {serverError && <Alert variant="error">{serverError}</Alert>}

      {farms.length > 1 && (
        <div>
          <Label htmlFor="crop-farm">{t("crop.farm")}</Label>
          <Select id="crop-farm" hasError={!!errors.farmId} {...register("farmId")}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name || t("farm.myFarm")} — {f.village}
              </option>
            ))}
          </Select>
          <FieldError>{errors.farmId && t(errors.farmId.message!)}</FieldError>
        </div>
      )}

      <div>
        <Label htmlFor="crop-crop">{t("crop.select")}</Label>
        <Select id="crop-crop" hasError={!!errors.cropId} {...register("cropId")}>
          <option value="">{t("common.selectPlaceholder")}</option>
          {cropsQuery.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {language === "en" ? c.name : c.translations[language] ?? c.name}
            </option>
          ))}
        </Select>
        <FieldError>{errors.cropId && t(errors.cropId.message!)}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="crop-area">{t("crop.area")}</Label>
          <Input id="crop-area" type="number" step="0.01" inputMode="decimal" hasError={!!errors.area} {...register("area")} />
          <FieldError>{errors.area && t(errors.area.message!)}</FieldError>
        </div>
        <div>
          <Label htmlFor="crop-area-unit">{t("farm.areaUnit")}</Label>
          <Select id="crop-area-unit" {...register("areaUnit")}>
            <option value="ACRE">{t("farm.areaUnit.acre")}</option>
            <option value="HECTARE">{t("farm.areaUnit.hectare")}</option>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="crop-yield">{t("crop.typicalYield")}</Label>
        <Input id="crop-yield" type="number" step="0.01" inputMode="decimal" {...register("typicalYield")} />
        <FieldError>{errors.typicalYield && t(errors.typicalYield.message!)}</FieldError>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5 rounded border-input" {...register("isPrimary")} />
        {t("crop.setAsPrimary")}
      </label>

      <Button type="submit" isLoading={isSubmitting} className="w-auto px-4 py-2.5 text-sm">
        {t("crop.add")}
      </Button>
    </form>
  );
}

export function CropManager({ crops, farms }: { crops: FarmerCrop[]; farms: Farm[] }) {
  const { t } = useI18n();

  if (farms.length === 0) {
    return <EmptyState message={t("crop.needsFarmFirst")} />;
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-medium">{t("crop.myCrops")}</h2>
      {crops.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("crop.empty")}</p>
      ) : (
        <div className="mt-3">
          {crops.map((crop) => (
            <CropRow key={crop.id} crop={crop} farms={farms} />
          ))}
        </div>
      )}
      <AddCropForm farms={farms} />
    </Card>
  );
}
