"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Package } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { lotApi } from "@/services/lotApi";
import { LotStatus } from "@/types/domain";

const STATUS_FILTERS: { value: LotStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "AVAILABLE", label: "Available" },
  { value: "PARTIALLY_COMMITTED", label: "Partly committed" },
  { value: "COMMITTED", label: "Committed" },
  { value: "STORED", label: "Stored" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

function LotsContent() {
  const [filter, setFilter] = React.useState<LotStatus | "ALL">("ALL");
  const lotsQuery = useQuery({
    queryKey: ["lots", "mine", filter],
    queryFn: () => lotApi.listMine(filter === "ALL" ? undefined : { status: filter }),
  });

  return (
    <div>
      <PageHeader
        title="My Lots"
        description="Produce you've listed for sale, with its status through discovery, quality, and trade."
        actions={
          <Link href="/lots/new">
            <Button className="w-auto px-4 py-2.5 text-sm">
              <Plus className="h-4 w-4" aria-hidden />
              New lot
            </Button>
          </Link>
        }
      />

      <div className="mb-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {lotsQuery.isLoading ? (
        <LoadingBlock />
      ) : lotsQuery.isError ? (
        <ErrorBlock message="Couldn't load your lots." onRetry={() => lotsQuery.refetch()} />
      ) : (lotsQuery.data ?? []).length === 0 ? (
        <EmptyState message="No lots match this filter yet." actionLabel="Create a lot" onAction={() => (window.location.href = "/lots/new")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lotsQuery.data!.map((lot) => (
            <Link
              key={lot.id}
              href={`/lots/${lot.id}`}
              className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Package className="h-5 w-5" aria-hidden />
                </span>
                <Badge tone={toneForStatus(lot.status)}>{lot.status.replace(/_/g, " ")}</Badge>
              </div>
              <div className="mt-4">
                <h3 className="font-semibold text-foreground">
                  {lot.crop?.name}
                  {lot.variety ? ` · ${lot.variety}` : ""}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {lot.quantity} {lot.unit} · Available {new Date(lot.availabilityDate).toLocaleDateString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LotsPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <LotsContent />
    </RoleProtectedPage>
  );
}
