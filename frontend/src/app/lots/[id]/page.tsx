"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Send,
  XCircle,
  History,
  ShieldCheck,
  LineChart,
  Warehouse as WarehouseIcon,
  Handshake,
  Scale,
  Sparkles,
} from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert, Label, FieldError } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { InsightPanel } from "@/components/InsightPanel";
import { lotApi } from "@/services/lotApi";
import { qualityApi } from "@/services/qualityApi";
import { marketApi } from "@/services/marketApi";
import { sellStoreApi } from "@/services/sellStoreApi";
import { warehouseApi } from "@/services/warehouseApi";
import { matchingApi, tradeOfferApi } from "@/services/tradeApi";
import { ApiRequestError } from "@/types/api";

function useLot(id: string) {
  return useQuery({ queryKey: ["lots", id], queryFn: () => lotApi.get(id) });
}

// -------- Overview tab -----------------------------------------------------

function OverviewTab({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const lotQuery = useLot(id);
  const historyQuery = useQuery({ queryKey: ["lots", id, "history"], queryFn: () => lotApi.history(id) });
  const [actionError, setActionError] = React.useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lots", id] });
    queryClient.invalidateQueries({ queryKey: ["lots", "mine"] });
  };

  const publish = useMutation({
    mutationFn: () => lotApi.publish(id),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiRequestError ? e.message : "Could not publish this lot."),
  });
  const cancel = useMutation({
    mutationFn: () => lotApi.cancel(id),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiRequestError ? e.message : "Could not cancel this lot."),
  });
  const remove = useMutation({
    mutationFn: () => lotApi.remove(id),
    onSuccess: () => router.push("/lots"),
    onError: (e) => setActionError(e instanceof ApiRequestError ? e.message : "Could not delete this lot."),
  });

  if (lotQuery.isLoading) return <LoadingBlock />;
  if (lotQuery.isError || !lotQuery.data) return <ErrorBlock message="Couldn't load this lot." onRetry={() => lotQuery.refetch()} />;

  const lot = lotQuery.data;

  return (
    <div className="space-y-6">
      {actionError && <Alert variant="error">{actionError}</Alert>}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              {lot.crop?.name}
              {lot.variety ? ` · ${lot.variety}` : ""}
            </h2>
            <p className="mt-1 text-muted-foreground">
              {lot.quantity} {lot.unit}
            </p>
          </div>
          <Badge tone={toneForStatus(lot.status)} className="text-sm">
            {lot.status.replace(/_/g, " ")}
          </Badge>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Harvest date</dt>
            <dd className="mt-0.5 font-medium">{lot.harvestDate ? new Date(lot.harvestDate).toLocaleDateString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Available from</dt>
            <dd className="mt-0.5 font-medium">{new Date(lot.availabilityDate).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Listed on</dt>
            <dd className="mt-0.5 font-medium">{new Date(lot.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
          {lot.status === "DRAFT" && (
            <Button className="w-auto px-4 py-2.5 text-sm" isLoading={publish.isPending} onClick={() => publish.mutate()}>
              <Send className="h-4 w-4" aria-hidden /> Publish lot
            </Button>
          )}
          {(lot.status === "DRAFT" || lot.status === "AVAILABLE") && (
            <Button
              variant="outline"
              className="w-auto px-4 py-2.5 text-sm"
              isLoading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              <XCircle className="h-4 w-4" aria-hidden /> Cancel lot
            </Button>
          )}
          {lot.status === "DRAFT" && (
            <Button
              variant="destructive"
              className="w-auto px-4 py-2.5 text-sm"
              isLoading={remove.isPending}
              onClick={() => {
                if (confirm("Delete this draft lot? This cannot be undone.")) remove.mutate();
              }}
            >
              Delete draft
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <History className="h-[18px] w-[18px]" aria-hidden /> Status history
        </h3>
        {historyQuery.isLoading ? (
          <LoadingBlock />
        ) : historyQuery.isError || !historyQuery.data?.length ? (
          <p className="text-sm text-muted-foreground">No history recorded yet.</p>
        ) : (
          <ol className="space-y-4 border-l border-border pl-4">
            {historyQuery.data.map((h, i) => (
              <li key={h.id ?? i} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                <p className="text-sm font-medium">
                  {h.fromStatus ? `${h.fromStatus.replace(/_/g, " ")} → ` : ""}
                  {h.toStatus.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</p>
                {h.note && <p className="mt-0.5 text-sm text-muted-foreground">{String(h.note)}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

// -------- Quality tab -------------------------------------------------------

function QualityTab({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const summaryQuery = useQuery({ queryKey: ["quality", "summary", id], queryFn: () => qualityApi.summaryForLot(id) });
  const listQuery = useQuery({ queryKey: ["quality", "list", id], queryFn: () => qualityApi.listForLot(id) });
  const [grade, setGrade] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => qualityApi.create(id, { source: "MANUAL", overallGrade: (grade || undefined) as any, notes: notes || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality", "summary", id] });
      queryClient.invalidateQueries({ queryKey: ["quality", "list", id] });
      setGrade("");
      setNotes("");
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't submit assessment."),
  });

  const requestAi = useMutation({
    mutationFn: () => qualityApi.create(id, { source: "AI" }),
    onSuccess: (assessment) => qualityApi.analyze(assessment.publicId).finally(() => {
      queryClient.invalidateQueries({ queryKey: ["quality", "summary", id] });
      queryClient.invalidateQueries({ queryKey: ["quality", "list", id] });
    }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't request an AI assessment."),
  });

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <h3 className="mb-3 text-lg font-semibold">Current quality summary</h3>
        {summaryQuery.isLoading ? (
          <LoadingBlock />
        ) : summaryQuery.isError ? (
          <p className="text-sm text-muted-foreground">No quality summary available yet for this lot.</p>
        ) : (
          <InsightPanel data={summaryQuery.data} />
        )}
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold">Add an assessment</h3>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">Grade (optional)</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="REJECTED">Rejected</option>
          </Select>
          <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button className="w-auto px-4" isLoading={create.isPending} onClick={() => create.mutate()}>
            Submit manual
          </Button>
        </div>
        <button
          type="button"
          onClick={() => requestAi.mutate()}
          disabled={requestAi.isPending}
          className="mt-3 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {requestAi.isPending ? "Requesting AI assessment…" : "Request an AI-assisted assessment"}
        </button>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold">Assessment history</h3>
        {listQuery.isLoading ? (
          <LoadingBlock />
        ) : listQuery.isError || !listQuery.data?.length ? (
          <p className="text-sm text-muted-foreground">No assessments recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {listQuery.data.map((a) => (
              <div key={a.publicId} className="rounded-xl border border-border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <Badge tone="neutral">{a.source}</Badge>
                  {a.overallGrade && <Badge tone={toneForStatus(a.overallGrade)}>Grade {a.overallGrade}</Badge>}
                </div>
                <InsightPanel data={a} skipKeys={["source", "overallGrade", "publicId", "id", "lotId"]} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// -------- Market & Sell-vs-Store tab -----------------------------------------

function MarketTab({ id, cropId }: { id: string; cropId?: string }) {
  const marketQuery = useQuery({
    queryKey: ["market", "lot-recommend", id],
    queryFn: () => marketApi.recommendForLot(id),
    retry: false,
  });
  const snapshotQuery = useQuery({
    queryKey: ["market", "snapshot", cropId],
    queryFn: () => marketApi.snapshot(cropId as string),
    enabled: !!cropId,
    retry: false,
  });

  const decisionMutation = useMutation({ mutationFn: () => sellStoreApi.analyze(id) });
  const historyQuery = useQuery({ queryKey: ["sell-store", "history", id], queryFn: () => sellStoreApi.history(id) });

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <LineChart className="h-[18px] w-[18px]" aria-hidden /> Best market for this lot
        </h3>
        {marketQuery.isLoading ? (
          <LoadingBlock />
        ) : marketQuery.isError ? (
          <p className="text-sm text-muted-foreground">Market recommendations aren&rsquo;t available for this lot right now.</p>
        ) : (
          <InsightPanel data={marketQuery.data} />
        )}
      </Card>

      {cropId && (
        <Card>
          <h3 className="mb-3 text-lg font-semibold">Price snapshot</h3>
          {snapshotQuery.isLoading ? (
            <LoadingBlock />
          ) : snapshotQuery.isError ? (
            <p className="text-sm text-muted-foreground">No recent price data for this crop yet.</p>
          ) : (
            <InsightPanel data={snapshotQuery.data} />
          )}
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Scale className="h-[18px] w-[18px]" aria-hidden /> Sell now or store?
          </h3>
          <Button
            className="w-auto px-4 py-2 text-sm"
            isLoading={decisionMutation.isPending}
            onClick={() => decisionMutation.mutate()}
          >
            Run analysis
          </Button>
        </div>
        {decisionMutation.isError && (
          <Alert variant="error" className="mb-3">
            Couldn&rsquo;t generate a decision — this can happen when there isn&rsquo;t enough market, quality, or storage data yet.
          </Alert>
        )}
        {decisionMutation.data ? (
          <InsightPanel data={decisionMutation.data} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Run the analysis to get a deterministic sell-now vs. store recommendation based on market conditions, quality, and storage
            availability.
          </p>
        )}

        {!!historyQuery.data?.length && (
          <div className="mt-5 border-t border-border pt-4">
            <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Past decisions</h4>
            <div className="space-y-2">
              {historyQuery.data.map((d: any, i: number) => (
                <div key={d.publicId ?? i} className="rounded-lg border border-border p-3 text-sm">
                  <InsightPanel data={d} />
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// -------- Warehouses tab -----------------------------------------------------

function WarehousesTab({ cropId }: { cropId?: string }) {
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!navigator.geolocation) {
      setLocError("Location isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocError("Location permission denied — enable it to see nearby warehouses."),
    );
  }, []);

  const recommendQuery = useQuery({
    queryKey: ["warehouses", "recommend", cropId, coords],
    queryFn: () =>
      warehouseApi.recommend({
        cropId: cropId as string,
        latitude: coords?.lat,
        longitude: coords?.lng,
      }),
    enabled: !!cropId,
    retry: false,
  });

  if (!cropId) return <p className="text-sm text-muted-foreground">Crop information unavailable for this lot.</p>;

  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <WarehouseIcon className="h-[18px] w-[18px]" aria-hidden /> Storage recommendations
      </h3>
      {locError && <Alert variant="info" className="mb-3">{locError} Showing results without location bias.</Alert>}
      {recommendQuery.isLoading ? (
        <LoadingBlock />
      ) : recommendQuery.isError ? (
        <p className="text-sm text-muted-foreground">No warehouse recommendations available right now.</p>
      ) : (
        <InsightPanel data={recommendQuery.data} />
      )}
    </Card>
  );
}

// -------- Buyer matches tab --------------------------------------------------

function BuyerMatchesTab({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const matchesQuery = useQuery({ queryKey: ["matches", id], queryFn: () => matchingApi.matchesForLot(id) });
  const [offerFor, setOfferFor] = React.useState<any | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Handshake className="h-[18px] w-[18px]" aria-hidden /> Matched buyers
        </h3>
        {matchesQuery.isLoading ? (
          <LoadingBlock />
        ) : matchesQuery.isError ? (
          <p className="text-sm text-muted-foreground">No buyer matches available right now.</p>
        ) : (matchesQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching buyer demand found for this lot yet. Check back soon.</p>
        ) : (
          <div className="space-y-3">
            {matchesQuery.data!.map((m, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold">{m.buyer?.organizationName ?? m.demand?.title ?? "Match"}</p>
                  <Button
                    variant="outline"
                    className="w-auto px-3 py-1.5 text-xs"
                    onClick={() => setOfferFor(m)}
                  >
                    Send offer
                  </Button>
                </div>
                <InsightPanel data={m} skipKeys={["buyer", "demand"]} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {offerFor && (
        <SendOfferCard
          lotPublicId={id}
          demandPublicId={offerFor.demand?.publicId}
          onClose={() => setOfferFor(null)}
          onSent={() => {
            setOfferFor(null);
            queryClient.invalidateQueries({ queryKey: ["trade-offers"] });
          }}
        />
      )}
    </div>
  );
}

function SendOfferCard({
  lotPublicId,
  demandPublicId,
  onClose,
  onSent,
}: {
  lotPublicId: string;
  demandPublicId?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [quantity, setQuantity] = React.useState("");
  const [unit, setUnit] = React.useState("QTL");
  const [price, setPrice] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      tradeOfferApi.create({
        lotPublicId,
        buyerDemandPublicId: demandPublicId,
        quantity: Number(quantity),
        quantityUnit: unit as any,
        offeredPrice: Number(price),
        message: message || undefined,
      }),
    onSuccess: onSent,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't send the offer."),
  });

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Send a trade offer</h3>
      {error && <Alert variant="error" className="mb-3">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Quantity</Label>
          <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <Label>Unit</Label>
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="KG">KG</option>
            <option value="QTL">QTL</option>
            <option value="TONNE">Tonne</option>
          </Select>
        </div>
        <div>
          <Label>Price per unit (₹)</Label>
          <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Label>Message (optional)</Label>
        <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Delivery terms, notes…" />
      </div>
      <div className="mt-4 flex gap-2">
        <Button className="w-auto px-4" isLoading={send.isPending} onClick={() => send.mutate()}>
          Send offer
        </Button>
        <Button variant="ghost" className="w-auto px-4" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// -------- Page ---------------------------------------------------------------

const TAB_ITEMS = [
  { value: "overview", label: "Overview" },
  { value: "quality", label: "Quality" },
  { value: "market", label: "Market & Decision" },
  { value: "warehouses", label: "Storage" },
  { value: "matches", label: "Buyer Matches" },
];

function LotDetailContent({ id }: { id: string }) {
  const [tab, setTab] = React.useState("overview");
  const lotQuery = useLot(id);

  return (
    <div>
      <PageHeader
        title={lotQuery.data ? `${lotQuery.data.crop?.name}${lotQuery.data.variety ? ` · ${lotQuery.data.variety}` : ""}` : "Lot"}
        description="Everything about this lot — status, quality, market fit, storage, and buyers."
        breadcrumb={
          <a href="/lots" className="hover:underline">
            ← Back to lots
          </a>
        }
      />
      <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} className="mb-6" />
      {tab === "overview" && <OverviewTab id={id} />}
      {tab === "quality" && <QualityTab id={id} />}
      {tab === "market" && <MarketTab id={id} cropId={lotQuery.data?.crop?.id} />}
      {tab === "warehouses" && <WarehousesTab cropId={lotQuery.data?.crop?.id} />}
      {tab === "matches" && <BuyerMatchesTab id={id} />}
    </div>
  );
}

export default function LotDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <RoleProtectedPage role="FARMER">
      <LotDetailContent id={params.id} />
    </RoleProtectedPage>
  );
}
