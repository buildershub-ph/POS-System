import type { Metadata } from "next";
import { AddProductWizard } from "@/components/add-product-wizard";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Add Product | Builder's Hub",
  description: "Add a supplier-linked product, photograph, SKU and printable barcode.",
};

export default function AddProductPage() {
  return <AppShell eyebrow="Catalogue setup" title="Add New Product" role="manager"><AddProductWizard /></AppShell>;
}
