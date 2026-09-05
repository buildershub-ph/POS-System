import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Transactions } from "@/components/transactions";

export const metadata: Metadata = {
  title: "Transactions | Builders Hub",
  description: "Sales history, invoice numbers, and cancellations.",
};

export default function TransactionsPage() {
  return (
    <AppShell eyebrow="Sales history" title="Transactions">
      <Transactions />
    </AppShell>
  );
}
