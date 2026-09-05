import { stockStatus } from "@/lib/mock-data";
import type { ProductVariant } from "@/lib/types";

export function StockBadge({ product, compact = false }: { product: ProductVariant; compact?: boolean }) {
  if (product.receiptStatus === "draft" && (product.incoming ?? 0) > 0) {
    return (
      <span className={`stock-badge stock-badge--incoming ${compact ? "stock-badge--compact" : ""}`}>
        <i /> Draft incoming: <strong>{product.incoming}</strong>
        {!compact && " units"}
      </span>
    );
  }
  const status = stockStatus(product);
  const label = status === "out_of_stock" ? "Out of stock" : status === "low_stock" ? "Low stock" : "Available";
  return (
    <span className={`stock-badge stock-badge--${status} ${compact ? "stock-badge--compact" : ""}`}>
      <i /> {label}: <strong>{product.available}</strong>
      {!compact && ` ${product.sellingUnit.replaceAll("_", "")}${product.available === 1 ? "" : "s"}`}
    </span>
  );
}
