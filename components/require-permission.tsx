"use client";

import type { ReactNode } from "react";
import { can, type Permission } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/use-current-user";

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  if (!can(user.role, permission)) {
    return (
      <div className="empty-state">
        <span>⚿</span>
        <h3>You don&apos;t have access to this page</h3>
        <p>Your account role doesn&apos;t include this. Ask an owner or manager if you need it.</p>
      </div>
    );
  }
  return <>{children}</>;
}
