"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Label, FieldError, Alert } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock } from "@/components/StateBlocks";
import { useStatesQuery, useDistrictsQuery } from "@/hooks/useReferenceData";
import { buyerApi } from "@/services/tradeApi";
import { ApiRequestError } from "@/types/api";
import { BusinessType } from "@/types/domain";

const schema = z.object({
  organizationName: z.string().min(2, "Organization name is required."),
  businessType: z.string().min(1, "Select a business type."),
  contactPerson: z.string().min(2, "Contact person is required."),
  phone: z.string().min(10, "Enter a valid phone number."),
  email: z.string().email("Enter a valid email.").optional().or(z.literal("")),
  address: z.string().optional(),
  stateId: z.string().min(1, "Select a state."),
  districtId: z.string().min(1, "Select a district."),
  website: z.string().optional(),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const BUSINESS_TYPES: BusinessType[] = ["PROCESSOR", "WHOLESALER", "RETAILER", "EXPORTER", "INSTITUTIONAL_BUYER", "TRADER", "OTHER"];

function BuyerProfileContent() {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const meQuery = useQuery({ queryKey: ["buyer", "me"], queryFn: () => buyerApi.me(), retry: false });

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  React.useEffect(() => {
    if (meQuery.data) {
      reset({
        organizationName: meQuery.data.organizationName,
        businessType: meQuery.data.businessType,
        contactPerson: meQuery.data.contactPerson,
        phone: meQuery.data.phone,
        email: meQuery.data.email ?? "",
        address: meQuery.data.address ?? "",
        stateId: "",
        districtId: "",
        website: meQuery.data.website ?? "",
        description: meQuery.data.description ?? "",
      });
    }
  }, [meQuery.data, reset]);

  const stateId = watch("stateId");
  const statesQuery = useStatesQuery();
  const districtsQuery = useDistrictsQuery(stateId || undefined);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const state = statesQuery.data?.find((s) => s.id === values.stateId)?.name ?? values.stateId;
      const district = districtsQuery.data?.find((d) => d.id === values.districtId)?.name ?? values.districtId;
      const payload = {
        organizationName: values.organizationName,
        businessType: values.businessType as BusinessType,
        contactPerson: values.contactPerson,
        phone: values.phone,
        email: values.email || undefined,
        address: values.address || undefined,
        state,
        district,
        website: values.website || undefined,
        description: values.description || undefined,
      };
      return meQuery.data ? buyerApi.updateProfile(payload) : buyerApi.createProfile(payload);
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["buyer", "me"] });
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e) => setServerError(e instanceof ApiRequestError ? e.message : "Couldn't save your profile."),
  });

  if (meQuery.isLoading) return <LoadingBlock />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Company profile"
        description="Buyers see your organization details when responding to lots or reviewing offers."
        actions={meQuery.data?.verificationStatus && <Badge tone={toneForStatus(meQuery.data.verificationStatus)}>{meQuery.data.verificationStatus}</Badge>}
      />

      <Card>
        {saved && <Alert variant="success" className="mb-4">Profile saved.</Alert>}
        {serverError && <Alert variant="error" className="mb-4">{serverError}</Alert>}

        <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <div>
            <Label htmlFor="organizationName">Organization name</Label>
            <Input id="organizationName" hasError={!!errors.organizationName} {...register("organizationName")} />
            <FieldError>{errors.organizationName?.message}</FieldError>
          </div>

          <div>
            <Label htmlFor="businessType">Business type</Label>
            <Select id="businessType" hasError={!!errors.businessType} {...register("businessType")}>
              <option value="">Select a type</option>
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            <FieldError>{errors.businessType?.message}</FieldError>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contactPerson">Contact person</Label>
              <Input id="contactPerson" hasError={!!errors.contactPerson} {...register("contactPerson")} />
              <FieldError>{errors.contactPerson?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" hasError={!!errors.phone} {...register("phone")} />
              <FieldError>{errors.phone?.message}</FieldError>
            </div>
          </div>

          <div>
            <Label htmlFor="email">Email (optional)</Label>
            <Input id="email" type="email" hasError={!!errors.email} {...register("email")} />
            <FieldError>{errors.email?.message}</FieldError>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="stateId">State</Label>
              <Select id="stateId" hasError={!!errors.stateId} {...register("stateId")}>
                <option value="">Select a state</option>
                {statesQuery.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <FieldError>{errors.stateId?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="districtId">District</Label>
              <Select id="districtId" disabled={!stateId} hasError={!!errors.districtId} {...register("districtId")}>
                <option value="">Select a district</option>
                {districtsQuery.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <FieldError>{errors.districtId?.message}</FieldError>
            </div>
          </div>

          <div>
            <Label htmlFor="address">Address (optional)</Label>
            <Input id="address" {...register("address")} />
          </div>

          <div>
            <Label htmlFor="website">Website (optional)</Label>
            <Input id="website" placeholder="https://" {...register("website")} />
          </div>

          <div>
            <Label htmlFor="description">About your business (optional)</Label>
            <textarea
              id="description"
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-[15px] outline-none ring-ring focus:ring-2"
              {...register("description")}
            />
          </div>

          <Button type="submit" isLoading={isSubmitting || save.isPending}>
            {meQuery.data ? "Save changes" : "Create profile"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function BuyerProfilePage() {
  return (
    <RoleProtectedPage role="BUYER">
      <BuyerProfileContent />
    </RoleProtectedPage>
  );
}
