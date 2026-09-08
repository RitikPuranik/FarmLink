"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePathname, useRouter } from "next/navigation";
import { NAV_BY_ROLE, ROLE_LABEL } from "@/components/nav/navConfig";

const TOUR_KEY = "anndata.onboarding.completed";

type Step = { target: string; title: string; text: string; route?: string };

const farmerSteps: Step[] = [
  { target: "[data-tour='dashboard-main']", title: "Your home", text: "See your produce, offers and important updates here." },
  { target: "[data-tour='nav-/farms']", title: "Farms", text: "Add and manage your farms and farm details." },
  { target: "[data-tour='nav-/crops']", title: "Crops", text: "Keep track of the crops you grow." },
  { target: "[data-tour='nav-/lots']", title: "Produce", text: "List your produce and see all your lots." },
  { target: "[data-tour='nav-/quality']", title: "Quality", text: "Check and record the quality of your produce." },
  { target: "[data-tour='nav-/market']", title: "Market prices", text: "Check mandi prices and market trends before selling." },
  { target: "[data-tour='nav-/forecasts']", title: "Price forecast", text: "See the available price forecast for your crop." },
  { target: "[data-tour='nav-/sell-vs-store']", title: "Sell or store", text: "Compare selling now with storing your produce." },
  { target: "[data-tour='nav-/warehouses']", title: "Storage", text: "Find nearby warehouses and check storage options." },
  { target: "[data-tour='nav-/trade-offers']", title: "Trade offers", text: "See buyer offers and continue a negotiation." },
  { target: "[data-tour='nav-/net-realization']", title: "Net amount", text: "Estimate what remains after known costs." },
  { target: "[data-tour='nav-/fpo-membership']", title: "Your FPO", text: "See your FPO membership and related information." },
  { target: "[data-tour='profile']", title: "Your profile", text: "Update your personal details and account settings." },
  { target: "[data-tour='nav']", title: "That is Anndata", text: "Everything you need is in this menu. You can come back here anytime." },
];

const buyerSteps: Step[] = [
  { target: "[data-tour='dashboard-main']", title: "Your home", text: "See your buying activity and important updates here." },
  { target: "[data-tour='nav-/buyer/demands']", title: "My demands", text: "Create and manage the produce you want to buy." },
  { target: "[data-tour='nav-/trade-offers']", title: "Trade offers", text: "Review offers and continue negotiations." },
  { target: "[data-tour='nav-/buyer/profile']", title: "Company profile", text: "Keep your buyer and business details up to date." },
  { target: "[data-tour='nav']", title: "Your menu", text: "Use this menu whenever you want to move around Anndata." },
];

function getRoleSteps(role: string): Step[] {
  if (role === "BUYER") return buyerSteps;
  if (role === "FARMER") return farmerSteps;

  const items = NAV_BY_ROLE[role as keyof typeof NAV_BY_ROLE] ?? [];
  const simpleDescriptions: Record<string, string> = {
    Dashboard: "Come here first to see the main things that need your attention.",
    Members: "Manage the people connected to your FPO.",
    "Pooled Lots": "See produce collected through your FPO.",
    Aggregation: "Plan and track crop collection targets.",
    Overview: "See the main platform information and status.",
    FPOs: "Manage FPO records and verification.",
    Buyers: "Review buyer accounts and details.",
    Warehouses: "Manage warehouse records and storage information.",
    Users: "Manage platform users and access.",
    "Transport Network": "Manage transporters and vehicle information.",
    "Storage Operations": "Manage storage work and warehouse activity.",
    Offers: "See transport or trade offers available to you.",
    "My Demands": "Create and manage the produce you want to buy.",
    "Company Profile": "Keep your company and buyer details up to date.",
  };

  const steps: Step[] = [
    { target: "[data-tour='dashboard-main']", title: "Your home", text: "This is your main workspace." },
  ];

  for (const item of items) {
    if (["/dashboard", "/buyer", "/fpo", "/admin", "/government"].includes(item.href)) continue;
    steps.push({
      target: `[data-tour='nav-${item.href}']`,
      title: item.label,
      text: simpleDescriptions[item.label] ?? `Open this page to ${item.label.toLowerCase()}.`,
    });
  }

  steps.push({ target: "[data-tour='nav']", title: "Your menu", text: `You are using Anndata as a ${ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? "user"}. Everything for your role is here.` });
  return steps;
}

export function OnboardingTour() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const [cardRect, setCardRect] = React.useState<DOMRect | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  const steps = React.useMemo(() => getRoleSteps(user?.role ?? ""), [user?.role]);
  const current = steps[step];
  const storageKey = `${TOUR_KEY}.${user?.id ?? user?.email ?? user?.role ?? "user"}`;

  React.useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const homePaths = ["/dashboard", "/buyer", "/fpo", "/admin", "/government"];
    if (!homePaths.includes(pathname)) return;
    if (window.localStorage.getItem(storageKey)) return;
    const timer = window.setTimeout(() => setOpen(true), 650);
    return () => window.clearTimeout(timer);
  }, [user, pathname, storageKey]);

  const updatePosition = React.useCallback(() => {
    if (!open || !current || typeof window === "undefined") return;

    // On small screens the full navigation lives in the drawer. Open it for
    // navigation steps so the user can actually see what the step points to.
    if (window.innerWidth < 760 && (current.target.startsWith("[data-tour='nav-") || current.target === "[data-tour='profile']")) {
      window.dispatchEvent(new Event("anndata:open-menu"));
    }

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
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      window.setTimeout(() => {
        const next = el.getBoundingClientRect();
        setRect(next);
      }, 220);
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

  if (!open || !user || !current) return null;

  const finish = () => {
    window.localStorage.setItem(storageKey, "1");
    setOpen(false);
  };

  const next = () => {
    if (step === steps.length - 1) return finish();
    const nextStep = step + 1;
    setStep(nextStep);
    const destination = steps[nextStep]?.route;
    if (destination && destination !== pathname) router.push(destination);
  };

  const back = () => {
    if (step === 0) return;
    const previousStep = step - 1;
    setStep(previousStep);
    const destination = steps[previousStep]?.route;
    if (destination && destination !== pathname) router.push(destination);
  };

  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const gap = 14;
  const margin = 12;
  const cardW = cardRect?.width ?? Math.min(340, viewportW - margin * 2);
  const cardH = cardRect?.height ?? 190;

  let left = rect ? rect.left + rect.width / 2 - cardW / 2 : viewportW / 2 - cardW / 2;
  let top = rect ? rect.bottom + gap : viewportH / 2 - cardH / 2;

  // Always keep the complete card on screen. If there is not enough room below
  // the highlighted item, place it above it. Then clamp it to the viewport.
  if (rect && top + cardH > viewportH - margin) {
    top = rect.top - cardH - gap;
  }
  if (top < margin) top = Math.min(viewportH - cardH - margin, margin);
  left = Math.max(margin, Math.min(left, viewportW - cardW - margin));

  const isMobile = viewportW < 760;
  if (isMobile) {
    left = margin;
    top = Math.max(margin, Math.min(top, viewportH - cardH - margin));
  }

  const spotlightStyle = rect
    ? { top: rect.top - 5, left: rect.left - 5, width: rect.width + 10, height: rect.height + 10 }
    : undefined;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={`Anndata tour step ${step + 1} of ${steps.length}`}>
      {rect && <div className="tour-spotlight" style={spotlightStyle} />}
      <div ref={cardRef} className="tour-card" style={{ top, left }}>
        <button className="tour-close" onClick={finish} aria-label="Close tour"><X /></button>
        <span className="tour-count">{step + 1} / {steps.length}</span>
        <h2>{current.title}</h2>
        <p>{current.text}</p>
        <div className="tour-footer">
          <button className="tour-skip" onClick={finish}>Skip tour</button>
          <div className="tour-controls">
            {step > 0 && <button className="tour-back" onClick={back}><ArrowLeft /> Back</button>}
            <button className="tour-next" onClick={next}>{step === steps.length - 1 ? "Done" : "Next"} {step < steps.length - 1 && <ArrowRight />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
