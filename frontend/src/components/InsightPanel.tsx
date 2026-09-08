import * as React from "react";
import { Badge, toneForStatus } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function humanize(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const STATUS_LIKE_KEYS = ["status", "outcome", "recommendation", "decision", "grade", "eligibility", "compatibility", "suitability", "freshness"];

function formatPrimitive(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString("en-IN") : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    // ISO date-ish strings render a bit more readably.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    return value;
  }
  return String(value);
}

/**
 * Renders any JSON-ish object as a readable grid of fields, recursing into
 * nested objects/arrays as labelled sub-sections. Used for the newer
 * analytical endpoints (sell-vs-store decisions, market snapshots,
 * warehouse suitability, net realization) whose exact response shape
 * depends on the scenario (e.g. INSUFFICIENT_DATA vs a full result) —
 * rather than binding tightly to fields that might not always be present,
 * this displays whatever the API actually returned.
 */
export function InsightPanel({ data, skipKeys = [] }: { data: unknown; skipKeys?: string[] }) {
  if (data === null || data === undefined) {
    return <p className="text-sm text-muted-foreground">No data available.</p>;
  }
  if (!isPlainObject(data)) {
    return <p className="text-sm">{formatPrimitive(data)}</p>;
  }

  const entries = Object.entries(data).filter(([k]) => !skipKeys.includes(k));
  const primitiveEntries = entries.filter(([, v]) => !isPlainObject(v) && !Array.isArray(v));
  const objectEntries = entries.filter(([, v]) => isPlainObject(v));
  const arrayEntries = entries.filter(([, v]) => Array.isArray(v));

  return (
    <div className="space-y-5">
      {primitiveEntries.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {primitiveEntries.map(([key, value]) => {
            const isStatusLike = STATUS_LIKE_KEYS.some((s) => key.toLowerCase().includes(s)) && typeof value === "string";
            return (
              <div key={key} className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{humanize(key)}</dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-foreground">
                  {isStatusLike ? (
                    <Badge tone={toneForStatus(value as string)}>{humanize(String(value))}</Badge>
                  ) : (
                    formatPrimitive(value)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {objectEntries.map(([key, value]) => (
        <div key={key} className="rounded-xl border border-border bg-secondary/40 p-4">
          <h4 className="mb-2 text-sm font-semibold text-foreground">{humanize(key)}</h4>
          <InsightPanel data={value} />
        </div>
      ))}

      {arrayEntries.map(([key, value]) => {
        const arr = value as unknown[];
        if (arr.length === 0) {
          return (
            <div key={key}>
              <h4 className="mb-1 text-sm font-semibold text-foreground">{humanize(key)}</h4>
              <p className="text-sm text-muted-foreground">None.</p>
            </div>
          );
        }
        return (
          <div key={key}>
            <h4 className="mb-2 text-sm font-semibold text-foreground">
              {humanize(key)} <span className="text-muted-foreground">({arr.length})</span>
            </h4>
            <div className="space-y-2">
              {arr.map((item, i) => (
                <div key={i} className={cn("rounded-xl border border-border p-3", i % 2 === 0 ? "bg-card" : "bg-secondary/30")}>
                  {isPlainObject(item) ? <InsightPanel data={item} /> : <p className="text-sm">{formatPrimitive(item)}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
