"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProductVariant } from "./types";

export function useInventory() {
  // Starts empty, not with the offline demo catalogue -- that catalogue uses
  // placeholder IDs (e.g. "catalogue-variant-002") that aren't real database
  // UUIDs, so anything sold against it before/instead of a real fetch would
  // fail. Only ever shown if the API itself reports demo mode.
  const [products, setProducts] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    return fetch("/api/inventory", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Inventory could not be loaded.");
        return response.json() as Promise<{ data?: ProductVariant[] }>;
      })
      .then((result) => {
        setProducts(result.data ?? []);
        setError("");
      })
      .catch(() => {
        setError("Inventory could not be loaded. Refresh the page or check your connection before selling anything.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(
    () => ["All", ...new Set(products.map((product) => product.category))],
    [products],
  );

  return { products, categories, loading, error, refetch: load };
}
