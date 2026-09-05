"use client";

import { useEffect, useMemo, useState } from "react";
import { products as fallbackProducts } from "./mock-data";
import type { ProductVariant } from "./types";

export function useInventory() {
  const [products, setProducts] = useState<ProductVariant[]>(fallbackProducts);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/inventory", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Inventory unavailable");
        return response.json() as Promise<{ data?: ProductVariant[] }>;
      })
      .then((result) => {
        if (active && result.data?.length) setProducts(result.data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(
    () => ["All", ...new Set(products.map((product) => product.category))],
    [products],
  );

  return { products, categories, loading };
}
