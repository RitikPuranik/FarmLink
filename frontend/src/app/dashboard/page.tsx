"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sprout,
  Wheat,
  Package,
  ShieldCheck,
  LineChart,
  Warehouse,
  Handshake,
  Building2,
  ArrowRight,
} from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useAuth } from "@/hooks/useAuth";
import { Alert, Card } from "@/components/ui/primitives";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { useFarmerProfileQuery } from "@/hooks/useFarmerProfile";
import { ProfileCompletionCard } from "@/components/farmer-profile/ProfileCompletionCard";
import { PageHeader, QuickLinkCard, StatCard } from "@/components/ui/stat-card";
import { ApiRequestError } from "@/types/api";
import { lotApi } from "@/services/lotApi";
import { tradeOfferApi } from "@/services/tradeApi";
import Link from "next/link";

function LotsAndOffersStats() {
  const lotsQuery = useQuery({ queryKey: ["lots", "mine"], queryFn: () => lotApi.listMine() });
  const offersQuery = useQuery({ queryKey: ["trade-offers", "mine"], queryFn: () => tradeOfferApi.list() });

  const activeLots = lotsQuery.data?.filter((l) => l.status !== "CANCELLED" && l.status !== "COMPLETED").length ?? null;
  const pendingOffers = offersQuery.data?.filter((o) => o.status === "PENDING" || o.status === "COUNTERED").length ?? null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard
        label="Active lots"
        value={activeLots ?? "—"}
        icon={<Package className="h-[18px] w-[18px]" />}
        href="/lots"
        hint="Produce ready or in process"
      />
      <StatCard
        label="Pending offers"
        value={pendingOffers ?? "—"}
        icon={<Handshake className="h-[18px] w-[18px]" />}
        href="/trade-offers"
        tone="accent"
        hint="Awaiting your response"
      />
      <StatCard
        label="Total lots"
        value={lotsQuery.data?.length ?? "—"}
        icon={<Wheat className="h-[18px] w-[18px]" />}
        href="/lots"
        hint="All time"
      />
      <StatCard
        label="Trade offers"
        value={offersQuery.data?.length ?? "—"}
        icon={<Handshake className="h-[18px] w-[18px]" />}
        href="/trade-offers"
        hint="Sent & received"
      />
    </div>
  );
}

function RecentLotsCard() {
  const lotsQuery = useQuery({ queryKey: ["lots", "mine"], queryFn: () => lotApi.listMine() });

  if (lotsQuery.isLoading) return <LoadingBlock />;
  if (lotsQuery.isError) return <ErrorBlock message="Couldn't load your lots." onRetry={() => lotsQuery.refetch()} />;

  const lots = (lotsQuery.data ?? []).slice(0, 5);

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent lots</h2>
        <Link href="/lots" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {lots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          You haven&rsquo;t listed any produce lots yet.{" "}
          <Link href="/lots/new" className="font-medium text-primary hover:underline">
            Create your first lot
          </Link>
          .
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {lots.map((lot) => (
            <li key={lot.id}>
              <Link href={`/lots/${lot.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {lot.crop?.name} {lot.variety ? `· ${lot.variety}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {lot.quantity} {lot.unit}
                  </p>
                </div>
                <Badge tone={toneForStatus(lot.status)}>{lot.status.replace(/_/g, " ")}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FarmerSummaryCard() {
  const { data, isLoading, isError, error, refetch } = useFarmerProfileQuery();

  if (isLoading) return <LoadingBlock />;

  if (isError || !data) {
    return (
      <ErrorBlock
        message={error instanceof ApiRequestError ? error.message : "We couldn't connect to the server."}
        onRetry={() => refetch()}
      />
    );
  }

  return <ProfileCompletionCard completion={data.completion} showLinkToProfile />;
}

const QUICK_LINKS = [
  { title: "My Farms", description: "Manage your plots of land and irrigation details.", icon: <Sprout className="h-5 w-5" />, href: "/farms" },
  { title: "My Crops", description: "Track what you grow and set your primary crop.", icon: <Wheat className="h-5 w-5" />, href: "/crops" },
  { title: "My Lots", description: "List produce for sale and track its status.", icon: <Package className="h-5 w-5" />, href: "/lots" },
  { title: "Quality", description: "View and request quality assessments for your lots.", icon: <ShieldCheck className="h-5 w-5" />, href: "/quality" },
  { title: "Market Prices", description: "Check mandi prices, trends, and nearby markets.", icon: <LineChart className="h-5 w-5" />, href: "/market" },
  { title: "Warehouses", description: "Find storage near you and check suitability.", icon: <Warehouse className="h-5 w-5" />, href: "/warehouses" },
  { title: "Trade Offers", description: "Negotiate and track offers from buyers.", icon: <Handshake className="h-5 w-5" />, href: "/trade-offers" },
  { title: "My FPO", description: "View your FPO membership or request to join one.", icon: <Building2 className="h-5 w-5" />, href: "/fpo-membership" },
];

function DashboardContent() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div>
      <PageHeader title={`Welcome back, ${user.fullName.split(" ")[0]}`} description="Here's what's happening across your farm business." />

      {user.accountStatus === "PENDING_VERIFICATION" && (
        <Alert variant="info" className="mb-6">
          Your account is pending verification. Some actions may be limited until it&rsquo;s confirmed.
        </Alert>
      )}

      <div className="mb-6">
        <LotsAndOffersStats />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <RecentLotsCard />
          <div>
            <h2 className="mb-3 text-lg font-semibold">Explore Anndata</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {QUICK_LINKS.map((link) => (
                <QuickLinkCard key={link.href} {...link} />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <FarmerSummaryCard />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <DashboardContent />
    </RoleProtectedPage>
  );
}
