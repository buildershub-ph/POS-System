import type { Metadata } from "next";
import { CashierMode } from "@/components/cashier-mode";
import { RequirePermission } from "@/components/require-permission";

export const metadata: Metadata = {
  title: "Cashier Mode | Builder's Hub",
};

export default function CashierPage() {
  return (
    <RequirePermission permission="processSale">
      <CashierMode />
    </RequirePermission>
  );
}
