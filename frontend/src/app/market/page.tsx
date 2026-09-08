"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, MapPin } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { InsightPanel } from "@/components/InsightPanel";
import { useCropsQuery } from "@/hooks/useReferenceData";
import { marketApi } from "@/services/marketApi";

const TAB_ITEMS = [
  { value: "snapshot", label: "Price Snapshot" },
  { value: "trends", label: "Trends" },
  { value: "nearby", label: "Nearby Mandis" },
];

function MarketContent() {
  const cropsQuery = useCropsQuery();
  const [cropId, setCropId] = React.useState("");
  const [tab, setTab] = React.useState("snapshot");
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (cropsQuery.data && cropsQuery.data.length > 0 && !cropId) {
      setCropId(cropsQuery.data[0].id);
    }
  }, [cropsQuery.data, cropId]);

  function useLocation() {
    if (!navigator.geolocation) {
      setLocError("Location isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocError("Location permission denied."),
    );
  }

  const snapshotQuery = useQuery({
    queryKey: ["market", "snapshot", cropId],
    queryFn: () => marketApi.snapshot(cropId),
    enabled: !!cropId && tab === "snapshot",
    retry: false,
  });
  const trendsQuery = useQuery({
    queryKey: ["market", "trends", cropId],
    queryFn: () => marketApi.trends(cropId, { days: 30 }),
    enabled: !!cropId && tab === "trends",
    retry: false,
  });
  const nearbyQuery = useQuery({
    queryKey: ["market", "nearby", cropId, coords],
    queryFn: () => marketApi.nearby({ latitude: coords!.lat, longitude: coords!.lng, cropId }),
    enabled: !!cropId && !!coords && tab === "nearby",
    retry: false,
  });

  return (
    <div>
      <PageHeader
        title="Market Prices"
        description="Live mandi price intelligence — snapshots, trends, and nearby markets to help you decide where and when to sell."
      />

      <Card className="mb-6">
        <div className="grid gap-3 sm:grid-cols-[2fr_auto]">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Crop</label>
            <Select value={cropId} onChange={(e) => setCropId(e.target.value)} disabled={cropsQuery.isLoading}>
              {(cropsQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {tab === "nearby" && (
            <div className="flex items-end">
              <Button variant="outline" className="w-auto px-4 py-3.5 text-sm" onClick={useLocation}>
                <MapPin className="h-4 w-4" aria-hidden /> Use my location
              </Button>
            </div>
          )}
        </div>
        {locError && <p className="mt-2 text-sm text-destructive">{locError}</p>}
      </Card>

      <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} className="mb-6" />

      <Card>
        {!cropId ? (
          <LoadingBlock />
        ) : tab === "snapshot" ? (
          snapshotQuery.isLoading ? (
            <LoadingBlock />
          ) : snapshotQuery.isError ? (
            <p className="text-sm text-muted-foreground">No recent price data for this crop yet.</p>
          ) : (
            <InsightPanel data={snapshotQuery.data} />
          )
        ) : tab === "trends" ? (
          trendsQuery.isLoading ? (
            <LoadingBlock />
          ) : trendsQuery.isError ? (
            <p className="text-sm text-muted-foreground">No trend data available for this crop yet.</p>
          ) : (
            <InsightPanel data={trendsQuery.data} />
          )
        ) : !coords ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <MapPin className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Share your location to see mandis near you.</p>
            <Button className="w-auto px-4" onClick={useLocation}>
              Use my location
            </Button>
          </div>
        ) : nearbyQuery.isLoading ? (
          <LoadingBlock />
        ) : nearbyQuery.isError ? (
          <p className="text-sm text-muted-foreground">No nearby mandis found.</p>
        ) : (
          <InsightPanel data={nearbyQuery.data} />
        )}
      </Card>
    </div>
  );
}

export default function MarketPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <MarketContent />
    </RoleProtectedPage>
  );
}
