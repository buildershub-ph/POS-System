"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

type AppShellProps = {
  children: ReactNode;
  title: string;
  eyebrow?: string;
  role?: UserRole;
  headerAction?: ReactNode;
  wide?: boolean;
};

const navItems = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/inventory", label: "Inventory", icon: "▣" },
  { href: "/receive", label: "Receive Stock", icon: "↧" },
  { href: "/inventory?view=low-stock", label: "Low Stock", icon: "!" },
  { href: "/scan", label: "Scan Product", icon: "⌗" },
  { href: "/inventory?view=transactions", label: "Transactions", icon: "⇄" },
];

export function AppShell({
  children,
  title,
  eyebrow,
  role = "cashier",
  headerAction,
  wide = false,
}: AppShellProps) {
  const pathname = usePathname();
  const salesMode = can(role, "processSale");

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Builder's Hub home">
          <span className="brand__mark"><span>⌂</span></span>
          <span className="brand__name">BUILDER&apos;S <strong>HUB</strong></span>
        </Link>

        {salesMode && (
          <Link className="cashier-launch" href="/cashier">
            <span>▤</span> Open Cashier Mode
          </Link>
        )}

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map((item) => {
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
        <div className="profile-card">
          <span className="avatar">AC</span>
          <span><strong>Ana Cruz</strong><small>{role === "cashier" ? "Cashier" : "Team member"}</small></span>
          <span aria-hidden="true">›</span>
        </div>
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
                <span>▤</span><span className="cart-button__count">2</span>
              </Link>
            )}
            <button className="avatar avatar--button" aria-label="Open profile menu">AC</button>
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
        <Link className={pathname.startsWith("/receive") ? "is-active" : ""} href="/receive"><span>↧</span><small>Activity</small></Link>
        <button type="button"><span>☰</span><small>More</small></button>
      </nav>
    </div>
  );
}

