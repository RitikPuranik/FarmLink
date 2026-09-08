"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Handshake, ArrowRight } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/stat-card";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { tradeOfferApi } from "@/services/tradeApi";

const FILTERS = ["ALL", "PENDING", "COUNTERED", "ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"] as const;

function TradeOffersContent() {
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("ALL");
  const offersQuery = useQuery({ queryKey: ["trade-offers", "mine"], queryFn: () => tradeOfferApi.list() });

  const offers = (offersQuery.data ?? []).filter((o) => filter === "ALL" || o.status === filter);

  return (
    <div>
      <PageHeader
        title="Trade Offers"
        description="Every offer you've sent or received — negotiate price and quantity until both sides agree."
      />

      <div className="mb-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {offersQuery.isLoading ? (
        <LoadingBlock />
      ) : offersQuery.isError ? (
        <ErrorBlock message="Couldn't load your trade offers." onRetry={() => offersQuery.refetch()} />
      ) : offers.length === 0 ? (
        <EmptyState message="No trade offers here yet. Offers you send or receive will show up in this list." />
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => (
            <Link
              key={offer.publicId}
              href={`/trade-offers/${offer.publicId}`}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md sm:p-5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Handshake className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {offer.quantity} {offer.quantityUnit} @ ₹{offer.offeredPrice}/unit
                  </p>
                  <p className="text-sm text-muted-foreground">{new Date(offer.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={toneForStatus(offer.status)}>{offer.status}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TradeOffersPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <TradeOffersContent />
      </AppShell>
    </ProtectedRoute>
  );
}
