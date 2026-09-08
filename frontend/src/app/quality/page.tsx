"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/primitives";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { InsightPanel } from "@/components/InsightPanel";
import { qualityApi } from "@/services/qualityApi";
import { lotApi } from "@/services/lotApi";
import { Badge, toneForStatus } from "@/components/ui/badge";

function QualityContent() {
  const summaryQuery = useQuery({ queryKey: ["quality", "farmer-summary"], queryFn: () => qualityApi.farmerSummary() });
  const lotsQuery = useQuery({ queryKey: ["lots", "mine"], queryFn: () => lotApi.listMine() });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality"
        description="Your produce quality assessments across all lots — request a check, review grades, and keep buyers confident in what you're selling."
      />

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Overview</h2>
        {summaryQuery.isLoading ? (
          <LoadingBlock />
        ) : summaryQuery.isError ? (
          <p className="text-sm text-muted-foreground">No quality summary available yet — assessments are recorded per lot.</p>
        ) : (
          <InsightPanel data={summaryQuery.data} />
        )}
      </Card>

      <Card>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-[18px] w-[18px]" aria-hidden /> Assess a lot
        </h2>
        {lotsQuery.isLoading ? (
          <LoadingBlock />
        ) : lotsQuery.isError || !lotsQuery.data?.length ? (
          <p className="text-sm text-muted-foreground">You don&rsquo;t have any lots yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lotsQuery.data.map((lot) => (
              <li key={lot.id}>
                <Link
                  href={`/lots/${lot.id}?tab=quality`}
                  className="flex items-center justify-between gap-3 py-3 hover:opacity-80"
                >
                  <div>
                    <p className="font-medium">
                      {lot.crop?.name}
                      {lot.variety ? ` · ${lot.variety}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {lot.quantity} {lot.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={toneForStatus(lot.status)}>{lot.status.replace(/_/g, " ")}</Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function QualityPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <QualityContent />
    </RoleProtectedPage>
  );
}
