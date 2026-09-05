"use client";

import { useEffect, useState } from "react";
import type { VariantMargin } from "./types";
import { useCurrentUser } from "./use-current-user";

/** Fetches cost & margin data — only ever requested, and only ever returned, for an owner. */
export function useOwnerMargins() {
  const { user } = useCurrentUser();
  const [margins, setMargins] = useState<Record<string, VariantMargin>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user.role !== "owner") return;
    let active = true;
    fetch("/api/inventory/costs", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cost data unavailable");
        return response.json() as Promise<{ data?: VariantMargin[] }>;
      })
      .then((result) => {
        if (!active) return;
        const byId = Object.fromEntries((result.data ?? []).map((margin) => [margin.variantId, margin]));
        setMargins(byId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.role]);

  return { margins, loading, isOwner: user.role === "owner" };
}
