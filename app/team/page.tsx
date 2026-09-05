import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";
import { TeamManagement } from "@/components/team-management";

export const metadata: Metadata = {
  title: "Team | Builder's Hub",
  description: "Create employee logins and manage roles.",
};

export default function TeamPage() {
  return (
    <AppShell eyebrow="Access & roles" title="Team">
      <RequirePermission permission="manageUsers">
        <TeamManagement />
      </RequirePermission>
    </AppShell>
  );
}
