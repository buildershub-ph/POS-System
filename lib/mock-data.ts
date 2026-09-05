import { buildersHubCatalogue } from "./builders-hub-catalogue";
import type { PaymentMethod, ProductVariant } from "./types";

export const categories = ["All", "Tiles", "Ceiling Panel", "Fluted Panel", "Doors", "Door Jamb"];

export const paymentMethods: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "split", label: "Split payment" },
];

export const products: ProductVariant[] = buildersHubCatalogue;

export function stockStatus(product: ProductVariant) {
  if (product.availability === "display_only") return "display_only" as const;
  if (product.available <= 0) return "out_of_stock" as const;
  if (product.available <= product.reorderLevel) return "low_stock" as const;
  return "in_stock" as const;
}

export function invoiceNumber(saleNumber: number) {
  return `INV-${String(saleNumber).padStart(4, "0")}`;
}

export function formatPeso(value?: number | null) {
  if (value == null) return "SRP pending";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);
}
