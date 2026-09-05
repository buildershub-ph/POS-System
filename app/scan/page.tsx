import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { BarcodeScanner } from "@/components/barcode-scanner";

export const metadata: Metadata = {
  title: "Scan Product | Builder's Hub",
};

export default function ScanPage() {
  return <AppShell eyebrow="Fast lookup" title="Scan Product"><BarcodeScanner /></AppShell>;
}

