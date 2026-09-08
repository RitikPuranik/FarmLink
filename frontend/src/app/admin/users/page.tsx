"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { adminApi } from "@/services/adminApi";

function AdminUsersContent() {
  const [search, setSearch] = React.useState("");
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: () => adminApi.users() });

  const filtered = (usersQuery.data ?? []).filter((u) => {
    const q = search.toLowerCase();
    return !q || u.fullName.toLowerCase().includes(q) || u.mobile.includes(q) || (u.email ?? "").toLowerCase().includes(q);
  });

  return (
    <div>
      <PageHeader title="Users" description="Everyone registered on the platform, across every role." />

      <Card className="mb-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-10" placeholder="Search by name, phone, or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {usersQuery.isLoading ? (
        <LoadingBlock />
      ) : usersQuery.isError ? (
        <ErrorBlock message="Couldn't load users." onRetry={() => usersQuery.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState message="No users match your search." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((u) => (
                  <tr key={u.publicId}>
                    <td className="px-4 py-3 font-medium">{u.fullName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.mobile}
                      {u.email ? ` · ${u.email}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">{u.role.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={toneForStatus(u.accountStatus)}>{u.accountStatus.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <RoleProtectedPage role="ADMIN">
      <AdminUsersContent />
    </RoleProtectedPage>
  );
}
