"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Handshake, UserCircle } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { useAuth } from "@/hooks/useAuth";
import { Alert, Card } from "@/components/ui/primitives";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { PageHeader, QuickLinkCard, StatCard } from "@/components/ui/stat-card";
import { LoadingBlock } from "@/components/StateBlocks";
import { buyerApi, demandApi, tradeOfferApi } from "@/services/tradeApi";

function BuyerStats() {
  const demandsQuery = useQuery({ queryKey: ["buyer-demands"], queryFn: () => demandApi.list() });
  const offersQuery = useQuery({ queryKey: ["trade-offers", "mine"], queryFn: () => tradeOfferApi.list() });

  const activeDemands = demandsQuery.data?.filter((d) => d.status === "ACTIVE").length ?? null;
  const pendingOffers = offersQuery.data?.filter((o) => o.status === "PENDING" || o.status === "COUNTERED").length ?? null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <StatCard label="Active demands" value={activeDemands ?? "—"} icon={<ClipboardList className="h-[18px] w-[18px]" />} href="/buyer/demands" />
      <StatCard
        label="Pending offers"
        value={pendingOffers ?? "—"}
        icon={<Handshake className="h-[18px] w-[18px]" />}
        href="/trade-offers"
        tone="accent"
      />
      <StatCard label="Total demands" value={demandsQuery.data?.length ?? "—"} icon={<ClipboardList className="h-[18px] w-[18px]" />} href="/buyer/demands" />
    </div>
  );
}

function ProfileStatusCard() {
  const meQuery = useQuery({ queryKey: ["buyer", "me"], queryFn: () => buyerApi.me(), retry: false });

  if (meQuery.isLoading) return <LoadingBlock />;

  if (meQuery.isError || !meQuery.data) {
    return (
      <Alert variant="info">
        Set up your company profile so farmers and the platform know who you are.{" "}
        <Link href="/buyer/profile" className="font-semibold underline">
          Create profile
        </Link>
        .
      </Alert>
    );
  }

  const buyer = meQuery.data;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{buyer.organizationName}</h3>
          <p className="text-sm text-muted-foreground">{buyer.businessType.replace(/_/g, " ")}</p>
        </div>
        {buyer.verificationStatus && <Badge tone={toneForStatus(buyer.verificationStatus)}>{buyer.verificationStatus}</Badge>}
      </div>
    </Card>
  );
}

const QUICK_LINKS = [
  { title: "My Demands", description: "Post what you need and manage existing demands.", icon: <ClipboardList className="h-5 w-5" />, href: "/buyer/demands" },
  { title: "Trade Offers", description: "Negotiate and respond to offers from farmers.", icon: <Handshake className="h-5 w-5" />, href: "/trade-offers" },
  { title: "Company Profile", description: "Keep your business details up to date.", icon: <UserCircle className="h-5 w-5" />, href: "/buyer/profile" },
];

function BuyerDashboardContent() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div>
      <PageHeader title={`Welcome back, ${user.fullName.split(" ")[0]}`} description="Manage your sourcing demand and trade offers." />
      <div className="mb-6">
        <BuyerStats />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <h2 className="mb-3 text-lg font-semibold">Explore</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {QUICK_LINKS.map((l) => (
                <QuickLinkCard key={l.href} {...l} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <ProfileStatusCard />
        </div>
      </div>
    </div>
  );
}

export default function BuyerDashboardPage() {
  return (
    <RoleProtectedPage role="BUYER">
      <BuyerDashboardContent />
    </RoleProtectedPage>
  );
}
