import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ProfitLossReport } from "@/components/profit-loss-report";
import { RequirePermission } from "@/components/require-permission";

export const metadata: Metadata = {
  title: "Profit & Loss | Builders Hub",
  description: "Sales, cost of goods sold, and gross profit for completed transactions.",
};

export default function ReportsPage() {
  return (
    <AppShell eyebrow="Owner report" title="Profit & Loss">
      <RequirePermission permission="viewPrivateCosts">
        <ProfitLossReport />
      </RequirePermission>
    </AppShell>
  );
}
