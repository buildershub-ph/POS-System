import type { Metadata } from "next";
import { CashierMode } from "@/components/cashier-mode";

export const metadata: Metadata = {
  title: "Cashier Mode | Builder's Hub",
};

export default function CashierPage() {
  return <CashierMode />;
}

