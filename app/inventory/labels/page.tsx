import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { LabelSheet } from "@/components/label-sheet";

export const metadata: Metadata = {
  title: "Print Barcode Labels | Builders Hub",
  description: "Select items and print 40x30mm barcode labels in one go.",
};

export default function LabelsPage() {
  return (
    <AppShell eyebrow="Inventory" title="Print Barcode Labels">
      <LabelSheet />
    </AppShell>
  );
}
