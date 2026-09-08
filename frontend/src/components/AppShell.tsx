"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X, ChevronRight, Bell, Search, CircleUserRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NAV_BY_ROLE, ROLE_LABEL, type NavItem } from "@/components/nav/navConfig";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/Logo";
import { OnboardingTour } from "@/components/OnboardingTour";

function isActive(pathname: string, item: NavItem) {
  if (["/dashboard", "/buyer", "/fpo", "/admin", "/government"].includes(item.href)) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function NavLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return <Link href={item.href} onClick={onClick} className={cn("app-nav-link", active && "active")} data-tour={item.href === "/profile" ? "profile" : `nav-${item.href}`}>
    <span className="app-nav-icon"><Icon className="h-[18px] w-[18px]" /></span><span>{item.label}</span>{active && <ChevronRight className="ml-auto h-4 w-4 opacity-60" />}
  </Link>;
}

function Brand() { return <Link href="/" className="app-brand"><span className="app-brand-mark"><LogoMark className="h-5 w-5" /></span><span>Anndata</span></Link>; }

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  React.useEffect(() => {
    const openFromTour = () => setDrawerOpen(true);
    window.addEventListener("anndata:open-menu", openFromTour);
    return () => window.removeEventListener("anndata:open-menu", openFromTour);
  }, []);
  if (!user) return <>{children}</>;
  const navItems = NAV_BY_ROLE[user.role] ?? [];
  const pathname = usePathname();
  const initials = user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "U";
  async function handleLogout() { setLoggingOut(true); try { await logout(); } finally { router.replace("/login"); setLoggingOut(false); } }

  return <div className="app-frame">
    <aside className="app-sidebar">
      <div><Brand /><div className="app-role"><span className="status-dot" /> {ROLE_LABEL[user.role]}</div></div>
      <nav className="app-nav" data-tour="nav">{navItems.map((item) => <NavLink key={item.href} item={item} />)}</nav>
      <div className="app-user">
        <Link href="/profile" className="app-user-card"><span className="avatar">{initials}</span><span className="min-w-0"><b>{user.fullName}</b><small>{ROLE_LABEL[user.role]}</small></span><CircleUserRound className="ml-auto h-4 w-4 opacity-50" /></Link>
        <button className="app-logout" onClick={handleLogout} disabled={loggingOut}><LogOut className="h-4 w-4" /> {loggingOut ? "Signing out…" : "Sign out"}</button>
      </div>
    </aside>

    <div className="app-main">
      <header className="app-topbar">
        <div className="mobile-only"><button className="icon-btn" onClick={() => setDrawerOpen(true)}><Menu /></button></div>
        <div className="topbar-search"><Search className="h-4 w-4" /><span>What do you need today?</span></div>
        <div className="topbar-actions"><button className="icon-btn" aria-label="Notifications"><Bell /></button><Link href="/profile" className="top-user"><span className="avatar small">{initials}</span><span className="desktop-only"><b>{user.fullName.split(" ")[0]}</b><small>{ROLE_LABEL[user.role]}</small></span></Link></div>
      </header>
      <main className="app-content" data-tour="dashboard-main">{children}</main>
    </div>

    {drawerOpen && <div className="mobile-drawer-backdrop" onClick={() => setDrawerOpen(false)}><aside className="mobile-drawer" onClick={(e) => e.stopPropagation()}><div className="drawer-head"><Brand /><button className="icon-btn" onClick={() => setDrawerOpen(false)}><X /></button></div><div className="app-role"><span className="status-dot" /> {ROLE_LABEL[user.role]}</div><nav className="app-nav">{navItems.map((item) => <NavLink key={item.href} item={item} onClick={() => setDrawerOpen(false)} />)}</nav><button className="app-logout" onClick={handleLogout} disabled={loggingOut}><LogOut className="h-4 w-4" /> Sign out</button></aside></div>}

    <nav className="mobile-bottom-nav">{navItems.slice(0, 5).map((item) => { const Icon = item.icon; const active = isActive(pathname, item); return <Link key={item.href} href={item.href} className={cn(active && "active")}><Icon /><span>{item.label}</span></Link>; })}</nav>
    <OnboardingTour />
  </div>;
}
