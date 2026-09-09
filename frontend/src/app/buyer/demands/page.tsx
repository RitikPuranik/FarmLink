"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ClipboardList } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Label, FieldError, Alert } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { FeatureTour } from "@/components/FeatureTour";
import { useCropsQuery, useStatesQuery, useDistrictsQuery } from "@/hooks/useReferenceData";
import { demandApi } from "@/services/tradeApi";
import { ApiRequestError } from "@/types/api";
import { applyServerFieldErrors } from "@/lib/formErrors";

const schema = z.object({
  cropId: z.string().min(1, "Select a crop."),
  title: z.string().min(3, "Give this demand a short title."),
  requiredQuantity: z.coerce.number().positive("Enter a quantity greater than zero."),
  quantityUnit: z.enum(["KG", "QTL", "TONNE"]),
  targetPrice: z.coerce.number().optional(),
  stateId: z.string().min(1, "Select a state."),
  districtId: z.string().min(1, "Select a district."),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

function NewDemandForm({ onCreated, isFirstDemand }: { onCreated: () => void; isFirstDemand: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const cropsQuery = useCropsQuery();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { quantityUnit: "QTL" } });

  const stateId = watch("stateId");
  const statesQuery = useStatesQuery();
  const districtsQuery = useDistrictsQuery(stateId || undefined);

  const create = useMutation({
    mutationFn: (values: FormValues) => {
      const state = statesQuery.data?.find((s) => s.id === values.stateId)?.name ?? values.stateId;
      const district = districtsQuery.data?.find((d) => d.id === values.districtId)?.name ?? values.districtId;
      return demandApi.create({
        cropId: values.cropId,
        title: values.title,
        requiredQuantity: values.requiredQuantity,
        quantityUnit: values.quantityUnit,
        targetPrice: values.targetPrice || undefined,
        state,
        district,
        description: values.description || undefined,
      });
    },
    onSuccess: () => {
      reset();
      setOpen(false);
      onCreated();
    },
    onError: (e) => {
      const message = applyServerFieldErrors(e, setError, [
        "cropId",
        "title",
        "requiredQuantity",
        "quantityUnit",
        "targetPrice",
        "stateId",
        "districtId",
        "description",
      ] as const);
      setServerError(message ?? (e instanceof ApiRequestError ? null : "Couldn't create this demand."));
    },
  });

  if (!open) {
    return (
      <Button className="w-auto px-4 py-2.5 text-sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> New demand
      </Button>
    );
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">New buyer demand</h2>
      {serverError && <Alert variant="error" className="mb-3">{serverError}</Alert>}
      <form className="space-y-4" onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" data-tour="demand-title-field" placeholder="e.g. Wheat for flour milling — Q3" hasError={!!errors.title} {...register("title")} />
          <FieldError>{errors.title?.message}</FieldError>
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

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Label htmlFor="requiredQuantity">Required quantity</Label>
            <Input id="requiredQuantity" data-tour="demand-quantity-field" type="number" hasError={!!errors.requiredQuantity} {...register("requiredQuantity")} />
            <FieldError>{errors.requiredQuantity?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="quantityUnit">Unit</Label>
            <Select id="quantityUnit" {...register("quantityUnit")}>
              <option value="KG">KG</option>
              <option value="QTL">QTL</option>
              <option value="TONNE">Tonne</option>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="targetPrice">Target price per unit (optional, ₹)</Label>
          <Input id="targetPrice" type="number" {...register("targetPrice")} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="stateId">Delivery state</Label>
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
          <Label htmlFor="description">Notes (optional)</Label>
          <Input id="description" {...register("description")} />
        </div>

        <div className="flex gap-2">
          <Button type="submit" data-tour="demand-submit-button" className="w-auto px-4" isLoading={isSubmitting || create.isPending}>
            Publish demand
          </Button>
          <Button type="button" variant="ghost" className="w-auto px-4" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
      <FeatureTour
        tourId="post-demand"
        enabled={isFirstDemand}
        steps={[
          {
            target: "[data-tour='demand-title-field']",
            title: "Describe what you need",
            text: "A short, clear title helps farmers understand your demand at a glance.",
          },
          {
            target: "[data-tour='demand-quantity-field']",
            title: "How much you need",
            text: "Enter the quantity you're looking for and pick the unit next to it.",
          },
          {
            target: "[data-tour='demand-submit-button']",
            title: "Publish it",
            text: "Once published, farmers with a matching crop and location can see and respond to this demand.",
          },
        ]}
      />
    </Card>
  );
}

function DemandsContent() {
  const queryClient = useQueryClient();
  const demandsQuery = useQuery({ queryKey: ["buyer-demands"], queryFn: () => demandApi.list() });
  const [actionError, setActionError] = React.useState<string | null>(null);

  const transition = useMutation({
    mutationFn: ({ publicId, action }: { publicId: string; action: "activate" | "pause" | "cancel" }) => demandApi.transition(publicId, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["buyer-demands"] }),
    onError: (e) => setActionError(e instanceof ApiRequestError ? e.message : "Couldn't update this demand."),
  });

  return (
    <div>
      <PageHeader
        title="My Demands"
        description="Tell farmers what you're looking for — quantity, price, and delivery location — and get matched automatically."
        actions={
          <NewDemandForm
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["buyer-demands"] })}
            isFirstDemand={!demandsQuery.isLoading && (demandsQuery.data?.length ?? 0) === 0}
          />
        }
      />

      {actionError && <Alert variant="error" className="mb-4">{actionError}</Alert>}

      {demandsQuery.isLoading ? (
        <LoadingBlock />
      ) : demandsQuery.isError ? (
        <ErrorBlock message="Couldn't load your demands." onRetry={() => demandsQuery.refetch()} />
      ) : demandsQuery.data!.length === 0 ? (
        <EmptyState message="You haven't posted any demands yet." />
      ) : (
        <div className="space-y-3">
          {demandsQuery.data!.map((d) => (
            <Card key={d.publicId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{d.title}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {d.requiredQuantity} {d.quantityUnit} · {d.district}, {d.state}
                    {d.targetPrice ? ` · ₹${d.targetPrice}/unit target` : ""}
                  </p>
                </div>
                <Badge tone={toneForStatus(d.status)}>{d.status}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                {d.status !== "ACTIVE" && d.status !== "FULFILLED" && d.status !== "CANCELLED" && (
                  <Button
                    variant="outline"
                    className="w-auto px-3 py-1.5 text-xs"
                    onClick={() => transition.mutate({ publicId: d.publicId, action: "activate" })}
                  >
                    Activate
                  </Button>
                )}
                {d.status === "ACTIVE" && (
                  <Button
                    variant="outline"
                    className="w-auto px-3 py-1.5 text-xs"
                    onClick={() => transition.mutate({ publicId: d.publicId, action: "pause" })}
                  >
                    Pause
                  </Button>
                )}
                {(d.status === "ACTIVE" || d.status === "PAUSED" || d.status === "DRAFT") && (
                  <Button
                    variant="destructive"
                    className="w-auto px-3 py-1.5 text-xs"
                    onClick={() => transition.mutate({ publicId: d.publicId, action: "cancel" })}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BuyerDemandsPage() {
  return (
    <RoleProtectedPage role="BUYER">
      <DemandsContent />
    </RoleProtectedPage>
  );
}
