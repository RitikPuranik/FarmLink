"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, ShieldAlert } from "lucide-react";
import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { PageHeader } from "@/components/ui/stat-card";
import { Card, Alert, Label } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock } from "@/components/StateBlocks";
import { buyerApi } from "@/services/tradeApi";
import { ApiRequestError } from "@/types/api";

function AdminBuyersContent() {
  const [publicId, setPublicId] = React.useState("");
  const [lookupId, setLookupId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const buyerQuery = useQuery({
    queryKey: ["admin", "buyer", lookupId],
    queryFn: () => buyerApi.byPublicId(lookupId as string),
    enabled: !!lookupId,
    retry: false,
  });

  const act = useMutation({
    mutationFn: (action: "verify" | "reject" | "suspend") => buyerApi.adminVerify(lookupId as string, action),
    onSuccess: () => buyerQuery.refetch(),
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Couldn't update this buyer."),
  });

  return (
    <div>
      <PageHeader title="Buyers" description="Look up a buyer by their public ID to verify, reject, or suspend their account." />

      <Card className="mb-6">
        <Label htmlFor="publicId">Buyer public ID</Label>
        <div className="flex gap-2">
          <Input id="publicId" placeholder="e.g. byr_9f2c1a…" value={publicId} onChange={(e) => setPublicId(e.target.value)} />
          <Button className="w-auto shrink-0 px-4" onClick={() => setLookupId(publicId.trim())} disabled={!publicId.trim()}>
            <Search className="h-4 w-4" aria-hidden /> Look up
          </Button>
        </div>
      </Card>

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {lookupId && (
        <Card>
          {buyerQuery.isLoading ? (
            <LoadingBlock />
          ) : buyerQuery.isError || !buyerQuery.data ? (
            <p className="text-sm text-muted-foreground">No buyer found with that public ID.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShieldAlert className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-semibold">{buyerQuery.data.organizationName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {buyerQuery.data.businessType.replace(/_/g, " ")} · {buyerQuery.data.district}, {buyerQuery.data.state}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {buyerQuery.data.contactPerson} · {buyerQuery.data.phone}
                    </p>
                  </div>
                </div>
                {buyerQuery.data.verificationStatus && <Badge tone={toneForStatus(buyerQuery.data.verificationStatus)}>{buyerQuery.data.verificationStatus}</Badge>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                <Button className="w-auto px-3 py-1.5 text-xs" isLoading={act.isPending && act.variables === "verify"} onClick={() => act.mutate("verify")}>
                  Verify
                </Button>
                <Button variant="destructive" className="w-auto px-3 py-1.5 text-xs" onClick={() => act.mutate("reject")}>
                  Reject
                </Button>
                <Button variant="outline" className="w-auto px-3 py-1.5 text-xs" onClick={() => act.mutate("suspend")}>
                  Suspend
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

export default function AdminBuyersPage() {
  return (
    <RoleProtectedPage role="ADMIN">
      <AdminBuyersContent />
    </RoleProtectedPage>
  );
}
