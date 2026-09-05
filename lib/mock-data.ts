import { initialOrderProducts } from "./initial-order-data";
import type { ProductVariant } from "./types";

export const categories = ["All", "Tiles", "Panels", "Accessories"];

export const products: ProductVariant[] = initialOrderProducts;

export function stockStatus(product: ProductVariant) {
  if (product.available <= 0) return "out_of_stock" as const;
  if (product.available <= product.reorderLevel) return "low_stock" as const;
  return "in_stock" as const;
}

export function formatPeso(value?: number | null) {
  if (value == null) return "SRP pending";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);
}
