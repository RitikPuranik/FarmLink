"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { FarmList } from "@/components/farms/FarmList";
import { ApiRequestError } from "@/types/api";

function FarmsContent() {
  const { data, isLoading, isError, error, refetch } = useFarmerProfileQuery();

  return (
    <div>
      <PageHeader
        title="My Farms"
        description="Every plot of land you farm — used to place lots, check storage suitability, and match you with nearby buyers."
        actions={
          <Link href="/farms/new">
            <Button className="w-auto px-4 py-2.5 text-sm">
              <Plus className="h-4 w-4" aria-hidden />
              Add a farm
            </Button>
          </Link>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : isError || !data ? (
        <ErrorBlock message={error instanceof ApiRequestError ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : (
        <FarmList farms={data.farms} />
      )}
    </div>
  );
}

export default function FarmsPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <FarmsContent />
    </RoleProtectedPage>
  );
}
