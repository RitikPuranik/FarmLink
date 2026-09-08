"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, ShieldAlert, Warehouse, Users } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader, QuickLinkCard, StatCard } from "@/components/ui/stat-card";
import { adminApi } from "@/services/adminApi";

function AdminStats() {
  const fposQuery = useQuery({ queryKey: ["admin", "fpos"], queryFn: () => adminApi.fpos() });
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: () => adminApi.users() });

  const pendingFpos = fposQuery.data?.filter((f) => f.verificationStatus === "PENDING" || f.verificationStatus === "UNDER_REVIEW").length ?? null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <StatCard label="Total FPOs" value={fposQuery.data?.length ?? "—"} icon={<Building2 className="h-[18px] w-[18px]" />} href="/admin/fpos" />
      <StatCard
        label="Pending verification"
        value={pendingFpos ?? "—"}
        icon={<Building2 className="h-[18px] w-[18px]" />}
        href="/admin/fpos"
        tone="accent"
      />
      <StatCard label="Registered users" value={usersQuery.data?.length ?? "—"} icon={<Users className="h-[18px] w-[18px]" />} href="/admin/users" />
    </div>
  );
}

const QUICK_LINKS = [
  { title: "FPOs", description: "Verify, reject, suspend, or reactivate producer organisations.", icon: <Building2 className="h-5 w-5" />, href: "/admin/fpos" },
  { title: "Buyers", description: "Review and verify buyer accounts.", icon: <ShieldAlert className="h-5 w-5" />, href: "/admin/buyers" },
  { title: "Warehouses", description: "Trigger a sync with the storage provider.", icon: <Warehouse className="h-5 w-5" />, href: "/admin/warehouses" },
  { title: "Users", description: "Browse everyone registered on the platform.", icon: <Users className="h-5 w-5" />, href: "/admin/users" },
];

function AdminOverviewContent() {
  return (
    <div>
      <PageHeader title="Platform Admin" description="Oversight for FPOs, buyers, warehouses, and platform users." />
      <div className="mb-6">
        <AdminStats />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {QUICK_LINKS.map((l) => (
          <QuickLinkCard key={l.href} {...l} />
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <RoleProtectedPage role="ADMIN">
      <AdminOverviewContent />
    </RoleProtectedPage>
  );
}
