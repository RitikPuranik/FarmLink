"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { useSelectedFpo } from "@/hooks/useSelectedFpo";
import { FpoPicker } from "@/components/fpo/FpoPicker";
import { fpoApi, membershipApi } from "@/services/fpoAdminApi";
import { ApiRequestError } from "@/types/api";

function MembersList({ fpoId }: { fpoId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const membersQuery = useQuery({ queryKey: ["fpo", "members", fpoId], queryFn: () => fpoApi.members(fpoId) });

  const act = useMutation({
    mutationFn: ({ membershipId, action }: { membershipId: string; action: "approve" | "reject" | "remove" | "suspend" | "reactivate" }) =>
      membershipApi[action](membershipId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fpo", "members", fpoId] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't update this member."),
  });

  if (membersQuery.isLoading) return <LoadingBlock />;
  if (membersQuery.isError) return <ErrorBlock message="Couldn't load members." onRetry={() => membersQuery.refetch()} />;
  if ((membersQuery.data ?? []).length === 0) return <EmptyState message="No members yet." />;

  return (
    <div className="space-y-3">
      {error && <Alert variant="error">{error}</Alert>}
      {membersQuery.data!.map((m) => (
        <Card key={m.membershipId}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{m.farmer?.fullName ?? "Farmer"}</p>
              <p className="text-sm text-muted-foreground">{m.farmer?.mobile}</p>
            </div>
            <Badge tone={toneForStatus(m.status)}>{m.status}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            {m.status === "PENDING" && (
              <>
                <Button
                  className="w-auto px-3 py-1.5 text-xs"
                  isLoading={act.isPending && act.variables?.membershipId === m.membershipId && act.variables.action === "approve"}
                  onClick={() => act.mutate({ membershipId: m.membershipId, action: "approve" })}
                >
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  className="w-auto px-3 py-1.5 text-xs"
                  isLoading={act.isPending && act.variables?.membershipId === m.membershipId && act.variables.action === "reject"}
                  onClick={() => act.mutate({ membershipId: m.membershipId, action: "reject" })}
                >
                  Reject
                </Button>
              </>
            )}
            {m.status === "ACTIVE" && (
              <>
                <Button
                  variant="outline"
                  className="w-auto px-3 py-1.5 text-xs"
                  onClick={() => act.mutate({ membershipId: m.membershipId, action: "suspend" })}
                >
                  Suspend
                </Button>
                <Button
                  variant="destructive"
                  className="w-auto px-3 py-1.5 text-xs"
                  onClick={() => act.mutate({ membershipId: m.membershipId, action: "remove" })}
                >
                  Remove
                </Button>
              </>
            )}
            {m.status === "SUSPENDED" && (
              <Button className="w-auto px-3 py-1.5 text-xs" onClick={() => act.mutate({ membershipId: m.membershipId, action: "reactivate" })}>
                Reactivate
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function FpoMembersContent() {
  const { fpoId, setFpoId, ready } = useSelectedFpo();
  if (!ready) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Members" description="Approve join requests and manage member status." />
      {fpoId ? <MembersList fpoId={fpoId} /> : <FpoPicker onSelect={(id) => setFpoId(id)} />}
    </div>
  );
}

export default function FpoMembersPage() {
  return (
    <RoleProtectedPage role="FPO_ADMIN">
      <FpoMembersContent />
    </RoleProtectedPage>
  );
}
