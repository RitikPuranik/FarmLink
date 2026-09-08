"use client";

import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/primitives";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { InsightPanel } from "@/components/InsightPanel";
import { governmentApi } from "@/services/adminApi";

function GovernmentContent() {
  const summaryQuery = useQuery({ queryKey: ["government", "fpo-summary"], queryFn: () => governmentApi.fpoSummary() });

  return (
    <div>
      <PageHeader
        title="FPO Insights"
        description="A read-only overview of Farmer Producer Organisations across the region — verification status, membership, and activity."
      />
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Landmark className="h-[18px] w-[18px]" aria-hidden /> Summary
        </h2>
        {summaryQuery.isLoading ? (
          <LoadingBlock />
        ) : summaryQuery.isError ? (
          <ErrorBlock message="Couldn't load the FPO summary." onRetry={() => summaryQuery.refetch()} />
        ) : (
          <InsightPanel data={summaryQuery.data} />
        )}
      </Card>
    </div>
  );
}

export default function GovernmentPage() {
  return (
    <RoleProtectedPage role="GOVERNMENT_VIEWER">
      <GovernmentContent />
    </RoleProtectedPage>
  );
}
