import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ReceiveStock } from "@/components/receive-stock";
import { RequirePermission } from "@/components/require-permission";

export const metadata: Metadata = {
  title: "Receive Stock | Builder's Hub",
};

export default function ReceivePage() {
  return (
    <AppShell eyebrow="Inventory transaction" title="Receive Stock">
      <RequirePermission permission="receiveStock">
        <ReceiveStock />
      </RequirePermission>
    </AppShell>
  );
}
