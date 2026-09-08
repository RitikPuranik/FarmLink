"use client";

import { useQuery } from "@tanstack/react-query";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/primitives";
import { LoadingBlock } from "@/components/StateBlocks";
import { InsightPanel } from "@/components/InsightPanel";
import { useSelectedFpo } from "@/hooks/useSelectedFpo";
import { FpoPicker } from "@/components/fpo/FpoPicker";
import { fpoApi } from "@/services/fpoAdminApi";

function AggregationContent({ fpoId }: { fpoId: string }) {
  const aggQuery = useQuery({ queryKey: ["fpo", "aggregation", fpoId], queryFn: () => fpoApi.cropAggregation(fpoId), retry: false });
  const analyticsQuery = useQuery({ queryKey: ["fpo", "analytics", fpoId], queryFn: () => fpoApi.analyticsOverview(fpoId), retry: false });

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Crop aggregation</h2>
        {aggQuery.isLoading ? (
          <LoadingBlock />
        ) : aggQuery.isError ? (
          <p className="text-sm text-muted-foreground">No aggregation data available yet.</p>
        ) : (
          <InsightPanel data={aggQuery.data} />
        )}
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">Analytics overview</h2>
        {analyticsQuery.isLoading ? (
          <LoadingBlock />
        ) : analyticsQuery.isError ? (
          <p className="text-sm text-muted-foreground">No analytics available yet.</p>
        ) : (
          <InsightPanel data={analyticsQuery.data} />
        )}
      </Card>
    </div>
  );
}

function FpoAggregationPageContent() {
  const { fpoId, setFpoId, ready } = useSelectedFpo();
  if (!ready) return null;

  return (
    <div>
      <PageHeader title="Crop Aggregation" description="Combined crop volumes and performance across all members of this FPO." />
      {fpoId ? <AggregationContent fpoId={fpoId} /> : <FpoPicker onSelect={(id) => setFpoId(id)} />}
    </div>
  );
}

export default function FpoAggregationPage() {
  return (
    <RoleProtectedPage role="FPO_ADMIN">
      <FpoAggregationPageContent />
    </RoleProtectedPage>
  );
}
