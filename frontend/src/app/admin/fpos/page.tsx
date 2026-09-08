"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Building2 } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock, ErrorBlock } from "@/components/StateBlocks";
import { EmptyState } from "@/components/EmptyState";
import { adminApi } from "@/services/adminApi";
import { ApiRequestError } from "@/types/api";

type Action = "verifyFpo" | "rejectFpo" | "suspendFpo" | "reactivateFpo";

function AdminFposContent() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const fposQuery = useQuery({ queryKey: ["admin", "fpos", search], queryFn: () => adminApi.fpos(search ? { name: search } : undefined) });

  const act = useMutation({
    mutationFn: ({ fpoId, action }: { fpoId: string; action: Action }) => adminApi[action](fpoId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "fpos"] }),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't update this FPO."),
  });

  return (
    <div>
      <PageHeader title="FPOs" description="Verify producer organisations before they can operate on the platform." />

      <Card className="mb-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-10" placeholder="Search FPOs by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {fposQuery.isLoading ? (
        <LoadingBlock />
      ) : fposQuery.isError ? (
        <ErrorBlock message="Couldn't load FPOs." onRetry={() => fposQuery.refetch()} />
      ) : (fposQuery.data ?? []).length === 0 ? (
        <EmptyState message="No FPOs found." />
      ) : (
        <div className="space-y-3">
          {fposQuery.data!.map((fpo) => (
            <Card key={fpo.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-semibold">{fpo.name}</h3>
                    <p className="text-sm text-muted-foreground">{fpo.organizationType}</p>
                  </div>
                </div>
                {fpo.verificationStatus && <Badge tone={toneForStatus(fpo.verificationStatus)}>{fpo.verificationStatus}</Badge>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                {(fpo.verificationStatus === "PENDING" || fpo.verificationStatus === "UNDER_REVIEW") && (
                  <>
                    <Button
                      className="w-auto px-3 py-1.5 text-xs"
                      isLoading={act.isPending && act.variables?.fpoId === fpo.id && act.variables.action === "verifyFpo"}
                      onClick={() => act.mutate({ fpoId: fpo.id, action: "verifyFpo" })}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="destructive"
                      className="w-auto px-3 py-1.5 text-xs"
                      onClick={() => act.mutate({ fpoId: fpo.id, action: "rejectFpo" })}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {fpo.verificationStatus === "VERIFIED" && (
                  <Button variant="outline" className="w-auto px-3 py-1.5 text-xs" onClick={() => act.mutate({ fpoId: fpo.id, action: "suspendFpo" })}>
                    Suspend
                  </Button>
                )}
                {fpo.verificationStatus === "SUSPENDED" && (
                  <Button className="w-auto px-3 py-1.5 text-xs" onClick={() => act.mutate({ fpoId: fpo.id, action: "reactivateFpo" })}>
                    Reactivate
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminFposPage() {
  return (
    <RoleProtectedPage role="ADMIN">
      <AdminFposContent />
    </RoleProtectedPage>
  );
}
