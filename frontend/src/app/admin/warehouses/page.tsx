"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, Warehouse } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { InsightPanel } from "@/components/InsightPanel";
import { adminApi } from "@/services/adminApi";
import { ApiRequestError } from "@/types/api";

function AdminWarehousesContent() {
  const [error, setError] = React.useState<string | null>(null);

  const sync = useMutation({
    mutationFn: () => adminApi.triggerWarehouseSync(),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't trigger the sync."),
  });

  return (
    <div>
      <PageHeader title="Warehouses" description="Trigger a sync with the connected storage provider to refresh capacity and availability data." />

      <Card>
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Warehouse className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex-1">
            <h3 className="font-semibold">Warehouse data sync</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Pulls the latest capacity, availability, and pricing information from the warehouse provider integration.
            </p>
            <Button className="mt-4 w-auto px-4" isLoading={sync.isPending} onClick={() => sync.mutate()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Trigger sync
            </Button>
          </div>
        </div>

        {error && <Alert variant="error" className="mt-4">{error}</Alert>}

        {sync.data && (
          <div className="mt-5 border-t border-border pt-4">
            <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Sync result</h4>
            <InsightPanel data={sync.data} />
          </div>
        )}
      </Card>
    </div>
  );
}

export default function AdminWarehousesPage() {
  return (
    <RoleProtectedPage role="ADMIN">
      <AdminWarehousesContent />
    </RoleProtectedPage>
  );
}
