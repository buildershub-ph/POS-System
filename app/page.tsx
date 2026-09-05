import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "Home | Builders Hub Inventory",
  description: "Role-based inventory workspace for Builders Hub.",
};

export default function HomePage() {
  return <AppShell eyebrow="Inventory workspace" title="Home"><Dashboard /></AppShell>;
}

