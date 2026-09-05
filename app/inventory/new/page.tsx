import type { Metadata } from "next";
import { AddProductWizard } from "@/components/add-product-wizard";
import { AppShell } from "@/components/app-shell";
import { RequirePermission } from "@/components/require-permission";

export const metadata: Metadata = {
  title: "Add Product | Builders Hub",
  description: "Add a supplier-linked product, photograph, SKU and printable barcode.",
};

export default function AddProductPage() {
  return (
    <AppShell eyebrow="Catalogue setup" title="Add New Product">
      <RequirePermission permission="manageProducts">
        <AddProductWizard />
      </RequirePermission>
    </AppShell>
  );
}
