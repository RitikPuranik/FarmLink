"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Search } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock } from "@/components/StateBlocks";
import { fpoApi, membershipApi } from "@/services/fpoAdminApi";
import { ApiRequestError } from "@/types/api";

function MyFpoCard() {
  const myFpoQuery = useQuery({ queryKey: ["fpo", "mine"], queryFn: () => membershipApi.myFpo(), retry: false });

  if (myFpoQuery.isLoading) return <LoadingBlock />;

  if (myFpoQuery.isError) {
    return (
      <Alert variant="info">
        You&rsquo;re not a member of any Farmer Producer Organisation yet. Search below to find and request to join one.
      </Alert>
    );
  }

  const fpo = (myFpoQuery.data as any)?.fpo ?? myFpoQuery.data;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{fpo?.name ?? "Your FPO"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{fpo?.organizationType ?? ""}</p>
        </div>
        {fpo?.membershipStatus && <Badge tone={toneForStatus(fpo.membershipStatus)}>{fpo.membershipStatus}</Badge>}
      </div>
    </Card>
  );
}

function FindFpoCard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [requested, setRequested] = React.useState<string | null>(null);

  const searchQuery = useQuery({
    queryKey: ["fpo", "search", search],
    queryFn: () => fpoApi.search({ name: search }),
    enabled: search.length > 1,
  });

  const requestJoin = useMutation({
    mutationFn: (fpoId: string) => fpoApi.requestMembership(fpoId),
    onSuccess: (_data, fpoId) => {
      setRequested(fpoId);
      queryClient.invalidateQueries({ queryKey: ["fpo", "mine"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't send a membership request."),
  });

  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Search className="h-[18px] w-[18px]" aria-hidden /> Find an FPO to join
      </h2>
      {error && <Alert variant="error" className="mb-3">{error}</Alert>}
      <Input placeholder="Search by FPO name…" value={search} onChange={(e) => setSearch(e.target.value)} />

      {search.length > 1 && (
        <div className="mt-4">
          {searchQuery.isLoading ? (
            <LoadingBlock />
          ) : searchQuery.isError || !searchQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">No FPOs found matching &ldquo;{search}&rdquo;.</p>
          ) : (
            <ul className="divide-y divide-border">
              {searchQuery.data.map((fpo) => (
                <li key={fpo.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{fpo.name}</p>
                    {fpo.verificationStatus && <Badge tone={toneForStatus(fpo.verificationStatus)}>{fpo.verificationStatus}</Badge>}
                  </div>
                  <Button
                    variant="outline"
                    className="w-auto px-3 py-2 text-sm"
                    disabled={requested === fpo.id}
                    isLoading={requestJoin.isPending && requestJoin.variables === fpo.id}
                    onClick={() => requestJoin.mutate(fpo.id)}
                  >
                    {requested === fpo.id ? "Requested" : "Request to join"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function FpoMembershipContent() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="My FPO"
        description="Farmer Producer Organisations help you pool produce with other members for better prices and easier logistics."
      />
      <MyFpoCard />
      <FindFpoCard />
    </div>
  );
}

export default function FpoMembershipPage() {
  return (
    <RoleProtectedPage role="FARMER">
      <FpoMembershipContent />
    </RoleProtectedPage>
  );
}
