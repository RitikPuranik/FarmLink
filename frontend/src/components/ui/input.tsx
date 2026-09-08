import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, hasError, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-12 w-full rounded-xl border bg-card px-4 text-sm font-medium shadow-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          hasError ? "border-destructive" : "border-input",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
