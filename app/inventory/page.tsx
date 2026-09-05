import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { InventoryCatalogue } from "@/components/inventory-catalogue";

export const metadata: Metadata = {
  title: "Inventory | Builders Hub",
  description: "Search product variants, prices and location availability.",
};

export default function InventoryPage() {
  return <AppShell eyebrow="Catalogue" title="Inventory" headerAction={<div className="header-button-group"><Link className="button button--secondary button--small" href="/receive">＋ Receive stock</Link><Link className="button button--primary button--small" href="/inventory/new">＋ Add product</Link></div>}><InventoryCatalogue /></AppShell>;
}
