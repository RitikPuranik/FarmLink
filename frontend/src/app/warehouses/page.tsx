"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Warehouse as WarehouseIcon } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/StateBlocks";
import { InsightPanel } from "@/components/InsightPanel";
import { useCropsQuery } from "@/hooks/useReferenceData";
import { warehouseApi } from "@/services/warehouseApi";

function WarehousesContent() {
  const cropsQuery = useCropsQuery();
  const [cropId, setCropId] = React.useState("");
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    if (cropsQuery.data && cropsQuery.data.length > 0 && !cropId) setCropId(cropsQuery.data[0].id);
  }, [cropsQuery.data, cropId]);

  function useLocation() {
    if (!navigator.geolocation) {
      setLocError("Location isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSearching(true);
      },
      () => setLocError("Location permission denied — enable it to find warehouses near you."),
    );
  }

  const nearbyQuery = useQuery({
    queryKey: ["warehouses", "nearby", coords, cropId],
    queryFn: () => warehouseApi.nearby({ latitude: coords!.lat, longitude: coords!.lng, cropId: cropId || undefined }),
    enabled: !!coords,
    retry: false,
  });

  return (
    <div>
      <PageHeader
        title="Warehouses"
        description="Find nearby storage and check how well-suited it is for your crop before you commit to selling or storing."
      />

      <Card className="mb-6">
        <div className="grid gap-3 sm:grid-cols-[2fr_auto]">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Crop (optional)</label>
            <Select value={cropId} onChange={(e) => setCropId(e.target.value)} disabled={cropsQuery.isLoading}>
              <option value="">Any crop</option>
              {(cropsQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-auto px-4 py-3.5 text-sm" onClick={useLocation}>
              <MapPin className="h-4 w-4" aria-hidden /> Find near me
            </Button>
          </div>
        </div>
        {locError && <p className="mt-2 text-sm text-destructive">{locError}</p>}
      </Card>

      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <WarehouseIcon className="h-[18px] w-[18px]" aria-hidden /> Results
        </h2>
        {!coords ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <MapPin className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Share your location to see warehouses near you.</p>
          </div>
        ) : nearbyQuery.isLoading ? (
          <LoadingBlock />
        ) : nearbyQuery.isError ? (
          <Alert variant="info">No warehouses found nearby right now.</Alert>
        ) : (
          <InsightPanel data={nearbyQuery.data} />
        )}
      </Card>
    </div>
  );
}

export default function WarehousesPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <WarehousesContent />
    </RoleProtectedPage>
  );
}
