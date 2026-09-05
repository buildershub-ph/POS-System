"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogueSetup, Supplier } from "./types";

const emptySetup: CatalogueSetup = { categories: [], locations: [], suppliers: [] };

export function useCatalogueSetup() {
  const [setup, setSetup] = useState<CatalogueSetup>(emptySetup);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/inventory/setup", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Setup lists could not be loaded.");
        return result.data as CatalogueSetup;
      })
      .then((data) => { if (active) setSetup(data); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Setup lists could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const addSupplier = useCallback(async (name: string) => {
    const response = await fetch("/api/inventory/suppliers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Supplier could not be added.");
    const supplier = result.data as Supplier;
    setSetup((current) => ({ ...current, suppliers: [...current.suppliers, supplier].sort((a, b) => a.name.localeCompare(b.name)) }));
    return supplier;
  }, []);

  return { setup, loading, error, addSupplier };
}
