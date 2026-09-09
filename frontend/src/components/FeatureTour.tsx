"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export type FeatureTourStep = {
  /** CSS selector for the element this step should point at, e.g. `[data-tour='farm-state']`. */
  target: string;
  title: string;
  text: string;
};

/**
 * A small, page-local walkthrough — the same visual system as
 * `OnboardingTour` (spotlight + card, reusing the `.tour-*` styles in
 * globals.css) but scoped to a single feature instead of the whole nav.
 *
 * Use this to explain a form or screen the *first* time a user reaches it —
 * e.g. the very first "Add farm" form, the first time adding a crop, etc.
 * Each tour is remembered per user per `tourId`, so it only ever shows once.
 *
 * Usage:
 *   <FeatureTour
 *     tourId="add-farm"
 *     enabled={farms.length === 0}
 *     steps={[
 *       { target: "[data-tour='farm-state']", title: "Pick your state", text: "…" },
 *       { target: "[data-tour='farm-submit']", title: "Save the farm", text: "…" },
 *     ]}
 *   />
 * and add a matching `data-tour="farm-state"` attribute to the target element.
 */
export function FeatureTour({
  tourId,
  steps,
  enabled = true,
  startDelay = 500,
}: {
  tourId: string;
  steps: FeatureTourStep[];
  /** Gate the tour on something other than "has the user already seen it" —
   * e.g. only show the add-farm tour while the farmer has zero farms yet. */
  enabled?: boolean;
  startDelay?: number;
}) {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const [cardRect, setCardRect] = React.useState<DOMRect | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  const current = steps[step];
  const storageKey = `anndata.tour.${tourId}.${user?.id ?? user?.email ?? "guest"}`;

  React.useEffect(() => {
    if (!enabled || !user || steps.length === 0 || typeof window === "undefined") return;
    if (window.localStorage.getItem(storageKey)) return;
    setStep(0);
    const timer = window.setTimeout(() => setOpen(true), startDelay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user, storageKey, startDelay, steps.length]);

  const updatePosition = React.useCallback(() => {
    if (!open || !current || typeof window === "undefined") return;
    const el = document.querySelector(current.target) as HTMLElement | null;
    if (!el) {
      setRect(null);
      window.setTimeout(() => {
        const retry = document.querySelector(current.target) as HTMLElement | null;
        if (retry) setRect(retry.getBoundingClientRect());
      }, 180);
      return;
    }
    const r = el.getBoundingClientRect();
    const inViewport = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    if (!inViewport) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      window.setTimeout(() => setRect(el.getBoundingClientRect()), 220);
    } else {
      setRect(r);
    }
  }, [open, current]);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    const onChange = () => window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, step, updatePosition]);

  React.useEffect(() => {
    if (!open || !cardRef.current) return;
    const measure = () => setCardRect(cardRef.current?.getBoundingClientRect() ?? null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cardRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, step, rect]);

  if (!open || !current) return null;

  const finish = () => {
    window.localStorage.setItem(storageKey, "1");
    setOpen(false);
  };
  const next = () => (step === steps.length - 1 ? finish() : setStep(step + 1));
  const back = () => step > 0 && setStep(step - 1);

  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const gap = 14;
  const margin = 12;
  const cardW = cardRect?.width ?? Math.min(340, viewportW - margin * 2);
  const cardH = cardRect?.height ?? 190;

  let left = rect ? rect.left + rect.width / 2 - cardW / 2 : viewportW / 2 - cardW / 2;
  let top = rect ? rect.bottom + gap : viewportH / 2 - cardH / 2;

  // Prefer placing the card below the highlighted element; flip above it if
  // there isn't room, then clamp so the whole card always stays on screen.
  if (rect && top + cardH > viewportH - margin) {
    top = rect.top - cardH - gap;
  }
  if (top < margin) top = Math.min(viewportH - cardH - margin, margin);
  left = Math.max(margin, Math.min(left, viewportW - cardW - margin));

  const spotlightStyle = rect
    ? { top: rect.top - 5, left: rect.left - 5, width: rect.width + 10, height: rect.height + 10 }
    : undefined;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={`Tour step ${step + 1} of ${steps.length}`}>
      {rect && <div className="tour-spotlight" style={spotlightStyle} />}
      <div ref={cardRef} className="tour-card" style={{ top, left }}>
        <button className="tour-close" onClick={finish} aria-label="Close tour">
          <X />
        </button>
        <span className="tour-count">
          {step + 1} / {steps.length}
        </span>
        <h2>{current.title}</h2>
        <p>{current.text}</p>
        <div className="tour-footer">
          <button className="tour-skip" onClick={finish}>
            Skip
          </button>
          <div className="tour-controls">
            {step > 0 && (
              <button className="tour-back" onClick={back}>
                <ArrowLeft /> Back
              </button>
            )}
            <button className="tour-next" onClick={next}>
              {step === steps.length - 1 ? "Done" : "Next"} {step < steps.length - 1 && <ArrowRight />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
