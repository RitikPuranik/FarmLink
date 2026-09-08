"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { NAV_BY_ROLE, ROLE_LABEL, type NavItem } from "@/components/nav/navConfig";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/Logo";

function isActive(pathname: string, item: NavItem) {
  if (item.href === "/dashboard" || item.href === "/buyer" || item.href === "/fpo" || item.href === "/admin" || item.href === "/government") {
    return pathname === item.href;
  }
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function NavLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-active text-white"
          : "text-sidebar-muted hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
      {active && <ChevronRight className="ml-auto h-4 w-4 opacity-70" aria-hidden />}
    </Link>
  );
}

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sidebar">
        <LogoMark className="h-[18px] w-[18px]" />
      </span>
      <span className="font-display text-[17px] font-bold tracking-tight text-white">Anndata</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  if (!user) return <>{children}</>;

  const navItems = NAV_BY_ROLE[user.role] ?? [];

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      router.push("/login");
    }
  }

  const initials = user.fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar px-3 py-5 lg:flex">
        <BrandMark />
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
              {initials || "U"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
              <p className="truncate text-xs text-sidebar-muted">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile topbar */}
      <header className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 lg:hidden">
        <BrandMark />
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-white hover:bg-white/10"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-sidebar px-3 py-5 shadow-xl animate-fade-in-up">
            <div className="flex items-center justify-between">
              <BrandMark />
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                {initials || "U"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
                <p className="truncate text-xs text-sidebar-muted">{ROLE_LABEL[user.role]}</p>
              </div>
            </div>
            <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} onClick={() => setDrawerOpen(false)} />
              ))}
            </nav>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="mt-2 flex w-full items-center gap-3 rounded-xl border-t border-white/10 px-3.5 pt-4 text-sm font-medium text-sidebar-muted hover:text-white disabled:opacity-60"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden />
              Log out
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="min-h-screen flex-1 pb-20 lg:pb-0">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 backdrop-blur lg:hidden">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return (
            <MobileTabLink key={item.href} item={item} Icon={Icon} />
          );
        })}
      </nav>
    </div>
  );
}

function MobileTabLink({ item, Icon }: { item: NavItem; Icon: NavItem["icon"] }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
      <span className="max-w-[64px] truncate">{item.label}</span>
    </Link>
  );
}
