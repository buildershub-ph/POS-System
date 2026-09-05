"use client";

import { useEffect, useState } from "react";
import type { UserRole } from "./types";

export type CurrentUser = {
  id: string;
  email?: string;
  fullName?: string;
  role: UserRole;
};

const fallbackUser: CurrentUser = { id: "guest", role: "cashier", fullName: "Team member" };

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorised, setUnauthorised] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          if (active) setUnauthorised(true);
          return null;
        }
        if (!response.ok) throw new Error("Could not load the current user.");
        const result = (await response.json()) as { data?: CurrentUser };
        return result.data ?? null;
      })
      .then((data) => {
        if (active && data) setUser(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { user: user ?? fallbackUser, loading, unauthorised };
}
