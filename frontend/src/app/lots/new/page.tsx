"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import { LoadingBlock } from "@/components/StateBlocks";
import { useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { useCropsQuery } from "@/hooks/useReferenceData";
import { FeatureTour } from "@/components/FeatureTour";
import { lotApi } from "@/services/lotApi";
import { ApiRequestError } from "@/types/api";

const lotSchema = z.object({
  farmId: z.string().min(1, "Select a farm."),
  cropId: z.string().min(1, "Select a crop."),
  quantity: z.coerce.number().positive("Quantity must be greater than zero."),
  unit: z.enum(["KG", "QTL", "TONNE"]),
  variety: z.string().optional(),
  harvestDate: z.string().optional(),
  availabilityDate: z.string().min(1, "Availability date is required."),
});
type LotFormValues = z.infer<typeof lotSchema>;

function NewLotContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profileQuery = useFarmerProfileQuery();
  const cropsQuery = useCropsQuery();
  // Reuses the same ["lots", "mine", filter] cache the /lots list page fills,
  // just to know whether this is the farmer's very first lot for tour gating.
  const lotsQuery = useQuery({ queryKey: ["lots", "mine", "ALL"], queryFn: () => lotApi.listMine() });
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LotFormValues>({
    resolver: zodResolver(lotSchema),
    defaultValues: { unit: "QTL", availabilityDate: new Date().toISOString().slice(0, 10) },
  });

  const createLot = useMutation({
    mutationFn: (values: LotFormValues) =>
      lotApi.create({
        farmId: values.farmId,
        cropId: values.cropId,
        quantity: values.quantity,
        unit: values.unit,
        variety: values.variety || undefined,
        harvestDate: values.harvestDate || undefined,
        availabilityDate: values.availabilityDate,
      }),
    onSuccess: (lot) => {
      queryClient.invalidateQueries({ queryKey: ["lots"] });
      router.push(`/lots/${lot.id}`);
    },
    onError: (err) => setServerError(err instanceof ApiRequestError ? err.message : "Something went wrong."),
  });

  if (profileQuery.isLoading || cropsQuery.isLoading) return <LoadingBlock />;

  const farms = profileQuery.data?.farms ?? [];

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="List a new lot" description="Add produce you have ready or nearly ready to sell." />
      {farms.length === 0 ? (
        <Alert variant="info">
          You need at least one farm before you can create a lot.{" "}
          <a href="/farms/new" className="font-semibold underline">
            Add a farm
          </a>
          .
        </Alert>
      ) : (
        <Card>
          <form className="space-y-4" onSubmit={handleSubmit((v) => createLot.mutate(v))} noValidate>
            {serverError && <Alert variant="error">{serverError}</Alert>}

            <div>
              <Label htmlFor="farmId">Farm</Label>
              <Select id="farmId" data-tour="lot-farm-field" hasError={!!errors.farmId} {...register("farmId")}>
                <option value="">Select a farm</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || f.village} — {f.district.name}
                  </option>
                ))}
              </Select>
              <FieldError>{errors.farmId?.message}</FieldError>
            </div>

            <div>
              <Label htmlFor="cropId">Crop</Label>
              <Select id="cropId" hasError={!!errors.cropId} {...register("cropId")}>
                <option value="">Select a crop</option>
                {(cropsQuery.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <FieldError>{errors.cropId?.message}</FieldError>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <Input id="quantity" data-tour="lot-quantity-field" type="number" step="any" hasError={!!errors.quantity} {...register("quantity")} />
                <FieldError>{errors.quantity?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="unit">Unit</Label>
                <Select id="unit" {...register("unit")}>
                  <option value="KG">Kilograms (KG)</option>
                  <option value="QTL">Quintal (QTL)</option>
                  <option value="TONNE">Tonne</option>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="variety">Variety (optional)</Label>
              <Input id="variety" placeholder="e.g. Basmati 1121" {...register("variety")} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="harvestDate">Harvest date (optional)</Label>
                <Input id="harvestDate" type="date" {...register("harvestDate")} />
              </div>
              <div>
                <Label htmlFor="availabilityDate">Available from</Label>
                <Input id="availabilityDate" type="date" hasError={!!errors.availabilityDate} {...register("availabilityDate")} />
                <FieldError>{errors.availabilityDate?.message}</FieldError>
              </div>
            </div>

            <Button type="submit" data-tour="lot-submit-button" isLoading={isSubmitting || createLot.isPending}>
              Create lot
            </Button>
          </form>
        </Card>
      )}
      <FeatureTour
        tourId="add-lot"
        enabled={(lotsQuery.data?.length ?? 0) === 0}
        steps={[
          {
            target: "[data-tour='lot-farm-field']",
            title: "Pick the farm",
            text: "Choose which of your farms this produce came from.",
          },
          {
            target: "[data-tour='lot-quantity-field']",
            title: "How much you have",
            text: "Enter the quantity ready to sell, and pick kg, quintal, or tonne next to it.",
          },
          {
            target: "[data-tour='lot-submit-button']",
            title: "List the lot",
            text: "Once this is saved, buyers can see it and you can track offers against it.",
          },
        ]}
      />
    </div>
  );
}

export default function NewLotPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <NewLotContent />
    </RoleProtectedPage>
  );
}
