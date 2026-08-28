"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label, FieldError, Alert } from "@/components/ui/primitives";
import { useDistrictsQuery, useIrrigationTypesQuery, useStatesQuery, useTalukasQuery } from "@/hooks/useReferenceData";
import { FarmFormValues, farmFormSchema } from "@/features/farms/farm.schemas";
import { ApiRequestError } from "@/types/api";

export function FarmForm({
  initialValues,
  onSubmit,
  submitLabel,
  onCancel,
}: {
  initialValues?: Partial<FarmFormValues>;
  onSubmit: (values: FarmFormValues) => Promise<void>;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FarmFormValues>({
    resolver: zodResolver(farmFormSchema),
    defaultValues: {
      areaUnit: "ACRE",
      irrigationType: "NOT_SPECIFIED",
      ...initialValues,
    },
  });

  const stateId = watch("stateId");
  const districtId = watch("districtId");

  const statesQuery = useStatesQuery();
  const districtsQuery = useDistrictsQuery(stateId || undefined);
  const talukasQuery = useTalukasQuery(districtId || undefined);
  const irrigationQuery = useIrrigationTypesQuery();

  // Build spec section 8: "When the state changes: clear district and
  // taluka" / "When the district changes: clear invalid taluka selection".
  // Skipped on the very first render so editing an existing farm doesn't
  // wipe out its own already-valid district/taluka on mount.
  const skipNextStateReset = React.useRef(true);
  React.useEffect(() => {
    if (skipNextStateReset.current) {
      skipNextStateReset.current = false;
      return;
    }
    setValue("districtId", "");
    setValue("talukaId", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateId]);

  const skipNextDistrictReset = React.useRef(true);
  React.useEffect(() => {
    if (skipNextDistrictReset.current) {
      skipNextDistrictReset.current = false;
      return;
    }
    setValue("talukaId", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtId]);

  async function handleFormSubmit(values: FarmFormValues) {
    setServerError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields) {
        setServerError(Object.values(err.fields)[0] ?? err.message);
      } else {
        setServerError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
      }
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(handleFormSubmit)} noValidate>
      {serverError && <Alert variant="error">{serverError}</Alert>}

      <div>
        <Label htmlFor="farm-name">{t("farm.name")}</Label>
        <Input id="farm-name" placeholder={t("farm.namePlaceholder")} {...register("name")} />
        <FieldError>{errors.name && t(errors.name.message!)}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="farm-state">{t("farm.state")}</Label>
          <Select id="farm-state" hasError={!!errors.stateId} {...register("stateId")}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {statesQuery.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <FieldError>{errors.stateId && t(errors.stateId.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="farm-district">{t("farm.district")}</Label>
          <Select id="farm-district" disabled={!stateId} hasError={!!errors.districtId} {...register("districtId")}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {districtsQuery.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <FieldError>{errors.districtId && t(errors.districtId.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="farm-taluka">{t("farm.taluka")}</Label>
          <Select id="farm-taluka" disabled={!districtId} hasError={!!errors.talukaId} {...register("talukaId")}>
            <option value="">{t("common.selectPlaceholder")}</option>
            {talukasQuery.data?.map((tk) => (
              <option key={tk.id} value={tk.id}>
                {tk.name}
              </option>
            ))}
          </Select>
          <FieldError>{errors.talukaId && t(errors.talukaId.message!)}</FieldError>
        </div>

        <div>
          <Label htmlFor="farm-village">{t("farm.village")}</Label>
          <Input id="farm-village" hasError={!!errors.village} {...register("village")} />
          <FieldError>{errors.village && t(errors.village.message!)}</FieldError>
        </div>
      </div>

      <div>
        <Label htmlFor="farm-pincode">{t("farm.pincode")}</Label>
        <Input
          id="farm-pincode"
          inputMode="numeric"
          maxLength={6}
          hasError={!!errors.pincode}
          {...register("pincode")}
        />
        <FieldError>{errors.pincode && t(errors.pincode.message!)}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="farm-area">{t("farm.area")}</Label>
          <Input
            id="farm-area"
            type="number"
            step="0.01"
            inputMode="decimal"
            hasError={!!errors.area}
            {...register("area")}
          />
          <FieldError>{errors.area && t(errors.area.message!)}</FieldError>
        </div>
        <div>
          <Label htmlFor="farm-area-unit">{t("farm.areaUnit")}</Label>
          <Select id="farm-area-unit" {...register("areaUnit")}>
            <option value="ACRE">{t("farm.areaUnit.acre")}</option>
            <option value="HECTARE">{t("farm.areaUnit.hectare")}</option>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="farm-irrigation">{t("farm.irrigation")}</Label>
        <Select id="farm-irrigation" {...register("irrigationType")}>
          {(irrigationQuery.data ?? [{ code: "NOT_SPECIFIED", labelKey: "irrigation.NOT_SPECIFIED" }]).map((i) => (
            <option key={i.code} value={i.code}>
              {t(i.labelKey)}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
