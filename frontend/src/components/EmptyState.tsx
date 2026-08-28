import * as React from "react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {actionLabel && onAction && (
        <Button variant="outline" className="mx-auto mt-3 w-auto px-4 py-2 text-sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
