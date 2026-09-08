"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { CropManager } from "@/components/crops/CropManager";
import { ApiRequestError } from "@/types/api";

function CropsContent() {
  const { data, isLoading, isError, error, refetch } = useFarmerProfileQuery();

  return (
    <div>
      <PageHeader
        title="My Crops"
        description="Crops you grow across your farms, including which one is your primary crop for each plot."
      />
      {isLoading ? (
        <LoadingBlock />
      ) : isError || !data ? (
        <ErrorBlock message={error instanceof ApiRequestError ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : data.farms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Add a farm first — crops are recorded against a specific plot of land.
        </div>
      ) : (
        <CropManager crops={data.crops} farms={data.farms} />
      )}
    </div>
  );
}

export default function CropsPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <CropsContent />
    </RoleProtectedPage>
  );
}
