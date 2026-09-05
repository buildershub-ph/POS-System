import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { products } from "@/lib/mock-data";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  let rows: Record<string, unknown>[];
  if (isSupabaseConfigured()) {
    const user = await authenticateRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    const response = await supabaseRest(request, "inventory_export?select=*&order=sku.asc");
    if (!response.ok) return NextResponse.json({ error: "Export failed." }, { status: response.status });
    rows = (await response.json()) as Record<string, unknown>[];
  } else {
    rows = products.map((product) => ({ sku: product.sku, barcode: product.barcode, product_name: product.productName, category: product.category, brand: product.brand, model: product.model, selling_price: product.srp, available_quantity: product.available, draft_incoming_quantity: product.incoming, receipt_status: product.receiptStatus, source_invoice: product.sourceInvoice, location: product.location }));
  }
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="builders-hub-inventory.csv"' } });
}
