import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Anndata mark: a stylised sheaf of grain — three blades fanning from a
 * single stem. "Anndata" (अन्नदाता) literally means "giver of grain/food",
 * so the glyph is drawn from that idea rather than a generic leaf/sprout.
 * Monochrome by design (uses currentColor) so it drops cleanly onto dark
 * sidebars, gold badges, or plain cream backgrounds without extra props.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-5 w-5", className)}
      aria-hidden
    >
      <g stroke="currentColor" strokeWidth="0" fill="currentColor">
        <path
          d="M16 19.5C16 19.5 9.5 17.3 8.2 10.6C7.9 9 8 7.4 8.4 6C11.7 6.7 14.2 8.6 15.4 11.6C16.4 14 16.4 16.8 16 19.5Z"
          opacity="0.55"
        />
        <path
          d="M16 19.5C16 19.5 22.5 17.3 23.8 10.6C24.1 9 24 7.4 23.6 6C20.3 6.7 17.8 8.6 16.6 11.6C15.6 14 15.6 16.8 16 19.5Z"
          opacity="0.55"
        />
        <path d="M16 21.5C16 21.5 12.6 18.2 12.6 12.4C12.6 9.9 13.3 7.7 14.4 6C15 6.8 16 8.4 16 12C16 8.4 17 6.8 17.6 6C18.7 7.7 19.4 9.9 19.4 12.4C19.4 18.2 16 21.5 16 21.5Z" />
      </g>
      <path
        d="M16 20.5V27"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12.5 27H19.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
  textClassName,
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className={cn("font-display text-lg font-bold tracking-tight", textClassName)}>Anndata</span>
    </span>
  );
}
