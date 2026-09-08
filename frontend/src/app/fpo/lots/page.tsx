"use client";

import { useQuery } from "@tanstack/react-query";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { useSelectedFpo } from "@/hooks/useSelectedFpo";
import { FpoPicker } from "@/components/fpo/FpoPicker";
import { lotApi } from "@/services/lotApi";

function LotsList({ fpoId }: { fpoId: string }) {
  const lotsQuery = useQuery({ queryKey: ["fpo", "lots", fpoId], queryFn: () => lotApi.listForFpo(fpoId) });

  if (lotsQuery.isLoading) return <LoadingBlock />;
  if (lotsQuery.isError) return <ErrorBlock message="Couldn't load pooled lots." onRetry={() => lotsQuery.refetch()} />;
  if ((lotsQuery.data ?? []).length === 0) return <EmptyState message="No lots pooled under this FPO yet." />;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {lotsQuery.data!.map((lot) => (
        <div key={lot.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">
              {lot.crop?.name}
              {lot.variety ? ` · ${lot.variety}` : ""}
            </h3>
            <Badge tone={toneForStatus(lot.status)}>{lot.status.replace(/_/g, " ")}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {lot.quantity} {lot.unit}
          </p>
        </div>
      ))}
    </div>
  );
}

function FpoLotsContent() {
  const { fpoId, setFpoId, ready } = useSelectedFpo();
  if (!ready) return null;

  return (
    <div>
      <PageHeader title="Pooled Lots" description="Produce lots listed by members under this FPO." />
      {fpoId ? <LotsList fpoId={fpoId} /> : <FpoPicker onSelect={(id) => setFpoId(id)} />}
    </div>
  );
}

export default function FpoLotsPage() {
  return (
    <RoleProtectedPage role="FPO_ADMIN">
      <FpoLotsContent />
    </RoleProtectedPage>
  );
}
