"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Package, BarChart3, RefreshCw } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader, QuickLinkCard, StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/primitives";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { useSelectedFpo } from "@/hooks/useSelectedFpo";
import { FpoPicker } from "@/components/fpo/FpoPicker";
import { fpoApi } from "@/services/fpoAdminApi";

function FpoOverview({ fpoId, onSwitch }: { fpoId: string; onSwitch: () => void }) {
  const detailsQuery = useQuery({ queryKey: ["fpo", "details", fpoId], queryFn: () => fpoApi.details(fpoId) });
  const membersQuery = useQuery({ queryKey: ["fpo", "members", fpoId], queryFn: () => fpoApi.members(fpoId) });

  if (detailsQuery.isLoading) return <LoadingBlock />;
  if (detailsQuery.isError || !detailsQuery.data) return <ErrorBlock message="Couldn't load this FPO." onRetry={() => detailsQuery.refetch()} />;

  const fpo = detailsQuery.data;
  const pendingCount = membersQuery.data?.filter((m) => m.status === "PENDING").length ?? null;
  const activeCount = membersQuery.data?.filter((m) => m.status === "ACTIVE").length ?? null;

  return (
    <div>
      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{fpo.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{fpo.organizationType}</p>
          </div>
          <div className="flex items-center gap-2">
            {fpo.verificationStatus && <Badge tone={toneForStatus(fpo.verificationStatus)}>{fpo.verificationStatus}</Badge>}
            <button onClick={onSwitch} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Switch FPO
            </button>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Active members" value={activeCount ?? "—"} icon={<Users className="h-[18px] w-[18px]" />} href="/fpo/members" />
        <StatCard label="Pending approvals" value={pendingCount ?? "—"} icon={<Users className="h-[18px] w-[18px]" />} href="/fpo/members" tone="accent" />
        <StatCard label="Pooled lots" value="View" icon={<Package className="h-[18px] w-[18px]" />} href="/fpo/lots" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <QuickLinkCard title="Members" description="Approve, suspend, or remove farmer members." icon={<Users className="h-5 w-5" />} href="/fpo/members" />
        <QuickLinkCard title="Pooled Lots" description="Produce lots listed under this FPO." icon={<Package className="h-5 w-5" />} href="/fpo/lots" />
        <QuickLinkCard title="Crop Aggregation" description="See combined crop volumes across members." icon={<BarChart3 className="h-5 w-5" />} href="/fpo/aggregation" />
      </div>
    </div>
  );
}

function FpoAdminContent() {
  const { fpoId, setFpoId, ready } = useSelectedFpo();

  if (!ready) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="FPO Dashboard" description="Manage your Farmer Producer Organisation's membership, lots, and aggregation." />
      {fpoId ? (
        <FpoOverview fpoId={fpoId} onSwitch={() => setFpoId(null)} />
      ) : (
        <FpoPicker onSelect={(id) => setFpoId(id)} />
      )}
    </div>
  );
}

export default function FpoAdminPage() {
  return (
    <RoleProtectedPage role="FPO_ADMIN">
      <FpoAdminContent />
    </RoleProtectedPage>
  );
}
