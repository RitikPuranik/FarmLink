"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Undo2, History, MessageSquareText } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert, Label, FieldError } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { InsightPanel } from "@/components/InsightPanel";
import { tradeOfferApi } from "@/services/tradeApi";
import { ApiRequestError } from "@/types/api";

function CounterForm({ publicId, onDone }: { publicId: string; onDone: () => void }) {
  const [quantity, setQuantity] = React.useState("");
  const [unit, setUnit] = React.useState("QTL");
  const [price, setPrice] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const counter = useMutation({
    mutationFn: () =>
      tradeOfferApi.counter(publicId, {
        quantity: Number(quantity),
        quantityUnit: unit as any,
        offeredPrice: Number(price),
        message: message || undefined,
      }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't send counter offer."),
  });

  return (
    <div className="mt-4 rounded-xl border border-border bg-secondary/40 p-4">
      <h4 className="mb-3 text-sm font-semibold">Send a counter offer</h4>
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
        <Input value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <Button className="mt-3 w-auto px-4" isLoading={counter.isPending} onClick={() => counter.mutate()}>
        Send counter offer
      </Button>
    </div>
  );
}

function TradeOfferDetailContent({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [showCounter, setShowCounter] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const offerQuery = useQuery({ queryKey: ["trade-offers", id], queryFn: () => tradeOfferApi.get(id) });
  const historyQuery = useQuery({ queryKey: ["trade-offers", id, "history"], queryFn: () => tradeOfferApi.history(id) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["trade-offers"] });
  };

  const accept = useMutation({
    mutationFn: () => tradeOfferApi.accept(id),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiRequestError ? e.message : "Couldn't accept this offer."),
  });
  const reject = useMutation({
    mutationFn: () => tradeOfferApi.reject(id),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiRequestError ? e.message : "Couldn't reject this offer."),
  });
  const withdraw = useMutation({
    mutationFn: () => tradeOfferApi.withdraw(id),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiRequestError ? e.message : "Couldn't withdraw this offer."),
  });

  if (offerQuery.isLoading) return <LoadingBlock />;
  if (offerQuery.isError || !offerQuery.data) return <ErrorBlock message="Couldn't load this offer." onRetry={() => offerQuery.refetch()} />;

  const offer = offerQuery.data;
  const canRespond = offer.status === "PENDING" || offer.status === "COUNTERED";

  return (
    <div>
      <PageHeader
        title="Trade offer"
        breadcrumb={
          <a href="/trade-offers" className="hover:underline">
            ← Back to trade offers
          </a>
        }
      />

      {actionError && <Alert variant="error" className="mb-4">{actionError}</Alert>}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-2xl font-bold">
              {offer.quantity} {offer.quantityUnit} @ ₹{offer.offeredPrice}
              <span className="text-base font-normal text-muted-foreground"> per unit</span>
            </p>
            {offer.deliveryTerms && <p className="mt-1 text-sm text-muted-foreground">Delivery: {offer.deliveryTerms}</p>}
            {offer.message && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {offer.message}
              </p>
            )}
          </div>
          <Badge tone={toneForStatus(offer.status)} className="text-sm">
            {offer.status}
          </Badge>
        </div>

        {canRespond && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
            <Button className="w-auto px-4 py-2.5 text-sm" isLoading={accept.isPending} onClick={() => accept.mutate()}>
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Accept
            </Button>
            <Button variant="outline" className="w-auto px-4 py-2.5 text-sm" onClick={() => setShowCounter((s) => !s)}>
              Counter offer
            </Button>
            <Button variant="destructive" className="w-auto px-4 py-2.5 text-sm" isLoading={reject.isPending} onClick={() => reject.mutate()}>
              <XCircle className="h-4 w-4" aria-hidden /> Reject
            </Button>
          </div>
        )}
        {offer.status === "PENDING" && (
          <div className="mt-2 flex flex-wrap gap-2 pt-2">
            <Button variant="ghost" className="w-auto px-4 py-2 text-sm" isLoading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              <Undo2 className="h-4 w-4" aria-hidden /> Withdraw offer
            </Button>
          </div>
        )}

        {showCounter && <CounterForm publicId={id} onDone={() => { setShowCounter(false); invalidate(); }} />}
      </Card>

      <Card className="mt-6">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <History className="h-[18px] w-[18px]" aria-hidden /> Negotiation history
        </h3>
        {historyQuery.isLoading ? (
          <LoadingBlock />
        ) : historyQuery.isError || !historyQuery.data?.length ? (
          <p className="text-sm text-muted-foreground">No history recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {historyQuery.data.map((h: any, i: number) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <InsightPanel data={h} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function TradeOfferDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <ProtectedRoute>
      <AppShell>
        <TradeOfferDetailContent id={params.id} />
      </AppShell>
    </ProtectedRoute>
  );
}
