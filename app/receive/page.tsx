import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ReceiveStock } from "@/components/receive-stock";

export const metadata: Metadata = {
  title: "Receive Stock | Builder's Hub",
};

export default function ReceivePage() {
  return <AppShell eyebrow="Inventory transaction" title="Receive Stock" role="stock_employee"><ReceiveStock /></AppShell>;
}

