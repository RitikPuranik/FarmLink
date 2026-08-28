import * as React from "react";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm">{label ?? "Loading…"}</span>
    </div>
  );
}

export function ErrorBlock({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="space-y-3">
      <Alert variant="error">{message}</Alert>
      {onRetry && (
        <Button variant="outline" className="w-auto px-4 py-2 text-sm" onClick={onRetry}>
          {retryLabel ?? "Try again"}
        </Button>
      )}
    </div>
  );
}
