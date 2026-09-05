import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Customers } from "@/components/customers";

export const metadata: Metadata = {
  title: "Customers | Builders Hub",
  description: "Repeat customers ranked by total purchases.",
};

export default function CustomersPage() {
  return (
    <AppShell eyebrow="Customer directory" title="Customers">
      <Customers />
    </AppShell>
  );
}
