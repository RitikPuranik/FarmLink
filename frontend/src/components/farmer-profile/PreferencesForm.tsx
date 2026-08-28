"use client";

import * as React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Card, Label, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { RadioCards } from "@/components/ui/radio-cards";
import { useFposQuery } from "@/hooks/useReferenceData";
import { useUpdateFarmerProfile } from "@/hooks/useFarmerProfile";
import { CommunicationPreference, Farm, FarmerProfile, FpoMembershipStatus, LiquidityPreference } from "@/types/farmer";
import { ApiRequestError } from "@/types/api";

const LIQUIDITY_KEYS: LiquidityPreference[] = ["URGENT", "WITHIN_3_DAYS", "WITHIN_1_WEEK", "CAN_WAIT_2_WEEKS", "FLEXIBLE"];
const FPO_STATUS_KEYS: FpoMembershipStatus[] = ["MEMBER", "NOT_A_MEMBER", "PENDING"];
const COMMUNICATION_KEYS: CommunicationPreference[] = ["IN_APP", "SMS", "WHATSAPP", "VOICE"];

export function PreferencesForm({ profile, farms }: { profile: FarmerProfile; farms: Farm[] }) {
  const { t } = useI18n();
  const updateProfile = useUpdateFarmerProfile();

  const [fpoStatus, setFpoStatus] = React.useState<FpoMembershipStatus | null>(profile.fpoMembershipStatus);
  const [fpoId, setFpoId] = React.useState<string>(profile.fpo?.id ?? "");
  const [liquidity, setLiquidity] = React.useState<LiquidityPreference | null>(profile.liquidityPreference);
  const [willingToStore, setWillingToStore] = React.useState<boolean | null>(profile.willingToStore);
  const [communication, setCommunication] = React.useState<CommunicationPreference>(profile.communicationPreference);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // A farmer's own district (from their first farm, if any) narrows the FPO
  // list to something locally relevant rather than every FPO nationwide.
  const primaryDistrictId = farms[0]?.district.id;
  const fposQuery = useFposQuery(fpoStatus === "MEMBER" ? primaryDistrictId : undefined);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateProfile.mutateAsync({
        fpoMembershipStatus: fpoStatus ?? undefined,
        fpoId: fpoStatus === "MEMBER" ? fpoId || undefined : null,
        liquidityPreference: liquidity ?? undefined,
        willingToStore: willingToStore ?? undefined,
        communicationPreference: communication,
      });
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields) {
        setError(Object.values(err.fields)[0] ?? err.message);
      } else {
        setError(err instanceof ApiRequestError ? err.message : t("common.networkError"));
      }
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-medium">{t("preferences.title")}</h2>
      <form className="space-y-6" onSubmit={handleSave}>
        {error && <Alert variant="error">{error}</Alert>}
        {saved && <Alert variant="success">{t("preferences.saved")}</Alert>}

        <div>
          <Label>{t("preferences.fpoQuestion")}</Label>
          <RadioCards
            name="fpoMembershipStatus"
            value={fpoStatus}
            onChange={setFpoStatus}
            options={FPO_STATUS_KEYS.map((key) => ({ value: key, label: t(`preferences.fpoStatus.${key}`) }))}
          />
          {fpoStatus === "MEMBER" && (
            <div className="mt-3">
              <Label htmlFor="fpo-select">{t("preferences.selectFpo")}</Label>
              <Select id="fpo-select" value={fpoId} onChange={(e) => setFpoId(e.target.value)}>
                <option value="">{t("common.selectPlaceholder")}</option>
                {fposQuery.data?.map((fpo) => (
                  <option key={fpo.id} value={fpo.id}>
                    {fpo.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div>
          <Label>{t("preferences.liquidityQuestion")}</Label>
          <RadioCards
            name="liquidityPreference"
            value={liquidity}
            onChange={setLiquidity}
            options={LIQUIDITY_KEYS.map((key) => ({ value: key, label: t(`preferences.liquidity.${key}`) }))}
          />
        </div>

        <div>
          <Label>{t("preferences.storageQuestion")}</Label>
          <RadioCards
            name="willingToStore"
            value={willingToStore === null ? null : willingToStore ? "yes" : "no"}
            onChange={(v) => setWillingToStore(v === "yes")}
            options={[
              { value: "yes", label: t("common.yes") },
              { value: "no", label: t("common.no") },
            ]}
          />
        </div>

        <div>
          <Label htmlFor="communication-preference">{t("preferences.communicationQuestion")}</Label>
          <Select
            id="communication-preference"
            value={communication}
            onChange={(e) => setCommunication(e.target.value as CommunicationPreference)}
          >
            {COMMUNICATION_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`preferences.communication.${key}`)}
              </option>
            ))}
          </Select>
        </div>

        <Button type="submit" isLoading={updateProfile.isPending}>
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}
