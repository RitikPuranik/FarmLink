import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * Renders a vertical stack of large, tappable option cards for a single
 * choice — build spec section 52's mock ("○ Immediately / ○ Within 3
 * days / ● I can wait") and section 55's "large inputs... simple cards"
 * requirement. Deliberately not a native <select> for these — a farmer
 * choosing a liquidity preference or answering yes/no benefits from seeing
 * every option at once rather than opening a dropdown.
 */
export function RadioCards<T extends string>({
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  options: RadioCardOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="space-y-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex w-full items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:pointer-events-none disabled:opacity-60",
              selected ? "border-primary bg-primary/5" : "border-input bg-card hover:bg-secondary",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
              )}
              aria-hidden
            >
              {selected && <Check className="h-3.5 w-3.5" />}
            </span>
            <span>
              <span className="block font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-sm text-muted-foreground">{option.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
