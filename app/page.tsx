import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "Home | Builder's Hub Inventory",
  description: "Role-based inventory workspace for Builder's Hub.",
};

export default function HomePage() {
  return <AppShell eyebrow="Inventory workspace" title="Home"><Dashboard /></AppShell>;
}

