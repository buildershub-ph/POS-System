"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/use-current-user";

type AppShellProps = {
  children: ReactNode;
  title: string;
  eyebrow?: string;
  headerAction?: ReactNode;
  wide?: boolean;
};

const navItems = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/inventory", label: "Inventory", icon: "▣" },
  { href: "/receive", label: "Receive Stock", icon: "↧", permission: "receiveStock" as const },
  { href: "/inventory?view=low-stock", label: "Low Stock", icon: "!" },
  { href: "/scan", label: "Scan Product", icon: "⌗" },
  { href: "/transactions", label: "Transactions", icon: "⇄" },
];

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function AppShell({
  children,
  title,
  eyebrow,
  headerAction,
  wide = false,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useCurrentUser();
  const role = user.role;
  const salesMode = can(role, "processSale");
  const manageTeam = can(role, "manageUsers");
  const displayName = user.fullName || user.email || "Team member";
  const visibleNavItems = navItems.filter((item) => !item.permission || can(role, item.permission));
  const items = manageTeam ? [...visibleNavItems, { href: "/team", label: "Team", icon: "☺" }] : visibleNavItems;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Builders Hub home">
          <span className="brand__mark"><span>BH</span></span>
          <span className="brand__name">BUILDERS <strong>HUB</strong></span>
        </Link>

        {salesMode && (
          <Link className="cashier-launch" href="/cashier">
            <span>▤</span> Open Cashier Mode
          </Link>
        )}

        <nav className="sidebar-nav" aria-label="Main navigation">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href.split("?")[0]);
            return (
              <Link className={active ? "is-active" : ""} href={item.href} key={item.label}>
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <button className="profile-card" onClick={logout} type="button" title="Sign out">
          <span className="avatar">{initials(displayName)}</span>
          <span><strong>{displayName}</strong><small>{role === "cashier" ? "Cashier" : role.replaceAll("_", " ")}</small></span>
          <span aria-hidden="true">⏻</span>
        </button>
      </aside>

      <main className={`app-main ${wide ? "app-main--wide" : ""}`}>
        <header className="topbar">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1>{title}</h1>
          </div>
          <div className="topbar__actions">
            {headerAction}
            {salesMode && pathname !== "/cashier" && (
              <Link className="icon-button cart-button" href="/cashier" aria-label="Open current sale">
                <span>▤</span>
              </Link>
            )}
            <button className="avatar avatar--button" aria-label="Open profile menu" onClick={logout} title="Sign out">{initials(displayName)}</button>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Link className={pathname === "/" ? "is-active" : ""} href="/"><span>⌂</span><small>Home</small></Link>
        <Link className={pathname.startsWith("/inventory") ? "is-active" : ""} href="/inventory"><span>▣</span><small>Inventory</small></Link>
        <Link className="mobile-nav__centre" href={salesMode ? "/cashier" : "/scan"}>
          <span>{salesMode ? "▤" : "⌗"}</span><small>{salesMode ? "Cashier" : "Scan"}</small>
        </Link>
        <Link className={pathname.startsWith("/receive") || pathname.startsWith("/transactions") ? "is-active" : ""} href={can(role, "receiveStock") ? "/receive" : "/transactions"}><span>↧</span><small>Activity</small></Link>
        <button onClick={logout} type="button"><span>⏻</span><small>Sign out</small></button>
      </nav>
    </div>
  );
}
