"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            // With the default staleTime of 0, every single navigation back
            // to an already-visited page (dashboard, farms, reference data
            // dropdowns, etc.) re-triggers a network request before the UI
            // is considered "fresh" — on a slow connection or backend that
            // reads like a fresh 10s hang each time. 30s means clicking
            // back and forth between recently-viewed pages reuses what's
            // already in memory instead of re-fetching every time; anything
            // actually mutated (a farm just added, a lot just created) is
            // still invalidated explicitly by its own mutation, so this
            // doesn't risk showing stale data after an edit.
            staleTime: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
