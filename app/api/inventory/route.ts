import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { products } from "@/lib/mock-data";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import type { ProductVariant, SellingUnit, VariantAvailability } from "@/lib/types";

type CatalogueRow = {
  id: string;
  product_name: string;
  category: string;
  brand: string;
  model: string;
  sku: string;
  supplier_sku: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  barcode: string;
  attributes: Record<string, string | number> | null;
  selling_unit: SellingUnit;
  srp: number | string | null;
  reorder_level: number | string;
  available_quantity: number | string;
  incoming_quantity: number | string;
  default_location_id: string | null;
  default_location: string | null;
  default_location_company: string | null;
  availability: VariantAvailability;
  photo_path: string | null;
  pieces_per_box: number | string | null;
  sqm_per_box: number | string | null;
  source_invoice: string | null;
  delivery_reference: string | null;
  delivery_date: string | null;
  draft_transaction_id: string | null;
};

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPortalProduct(row: CatalogueRow): ProductVariant {
  const attributes = row.attributes ?? {};
  const incoming = number(row.incoming_quantity);
  const srp = number(row.srp);
  const artwork = row.category === "Tiles" ? "tile"
    : row.category === "Panels" || row.category === "Ceiling Panel" || row.category === "Fluted Panel" || row.category === "Accessories" ? "panel"
    : row.category === "Doors" ? "door"
    : "generic";
  return {
    id: row.id,
    productSlug: slug(row.sku),
    productName: row.product_name,
    category: row.category,
    brand: row.brand,
    model: row.model,
    sku: row.sku,
    supplierSku: row.supplier_sku ?? undefined,
    supplierId: row.supplier_id ?? undefined,
    supplierName: row.supplier_name ?? undefined,
    barcode: row.barcode,
    color: String(attributes.Color ?? attributes.color ?? "") || undefined,
    size: String(attributes.Size ?? attributes.size ?? "") || undefined,
    attributes,
    sellingUnit: row.selling_unit,
    srp: srp > 0 ? srp : undefined,
    available: number(row.available_quantity),
    incoming,
    reorderLevel: number(row.reorder_level),
    location: row.default_location ?? "Location pending",
    locationId: row.default_location_id ?? undefined,
    locationCompany: row.default_location_company ?? undefined,
    availability: row.availability ?? "stocked",
    receiptStatus: incoming > 0 ? "draft" : "posted",
    sourceInvoice: row.source_invoice ?? (String(attributes["Source invoice"] ?? "") || undefined),
    deliveryReference: row.delivery_reference ?? undefined,
    deliveryDate: row.delivery_date ?? undefined,
    draftTransactionId: row.draft_transaction_id ?? undefined,
    photo: row.photo_path ? `/api/inventory/photos/${row.photo_path.split("/").map(encodeURIComponent).join("/")}` : artwork,
    photoAlt: `${row.product_name} product photograph`,
    piecesPerBox: row.pieces_per_box == null ? undefined : number(row.pieces_per_box),
    sqmPerBox: row.sqm_per_box == null ? undefined : number(row.sqm_per_box),
  };
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ data: products, mode: "demo" });
  }
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const response = await supabaseRest(request, "portal_catalogue?select=*&active=eq.true&order=product_name.asc");
  if (!response.ok) return NextResponse.json({ error: "Unable to load inventory." }, { status: response.status });
  const rows = (await response.json()) as CatalogueRow[];
  return NextResponse.json({ data: rows.map(toPortalProduct), mode: "live" });
}
