"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Building2 } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { LoadingBlock } from "@/components/StateBlocks";
import { fpoApi } from "@/services/fpoAdminApi";

export function FpoPicker({ onSelect }: { onSelect: (fpoId: string, name: string) => void }) {
  const [search, setSearch] = React.useState("");
  const searchQuery = useQuery({
    queryKey: ["fpo", "search", search],
    queryFn: () => fpoApi.search({ name: search }),
    enabled: search.length > 1,
  });

  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Building2 className="h-[18px] w-[18px]" aria-hidden /> Which FPO do you manage?
      </h2>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="pl-10" placeholder="Search FPO by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
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
                  <Button variant="outline" className="w-auto px-3 py-1.5 text-sm" onClick={() => onSelect(fpo.id, fpo.name)}>
                    Select
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
