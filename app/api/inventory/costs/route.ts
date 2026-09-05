import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import type { VariantMargin } from "@/lib/types";

type MarginRow = {
  id: string;
  sku: string;
  srp: number | string;
  unit_cost: number | string;
  landed_cost: number | string;
  minimum_selling_price: number | string;
  gross_margin_amount: number | string;
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Cost and margin are kept out of the main /api/inventory response on purpose —
// this endpoint is the only place they are ever returned, and only to an owner.
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ data: [] as VariantMargin[], mode: "demo" });
  }
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (user.role !== "owner") {
    return NextResponse.json({ error: "Only an owner can view cost and margin data." }, { status: 403 });
  }

  const response = await supabaseRest(request, "owner_margin_report?select=*");
  if (!response.ok) return NextResponse.json({ error: "Unable to load cost data." }, { status: response.status });
  const rows = (await response.json()) as MarginRow[];
  const data: VariantMargin[] = rows.map((row) => ({
    variantId: row.id,
    sku: row.sku,
    srp: number(row.srp),
    unitCost: number(row.unit_cost),
    landedCost: number(row.landed_cost),
    minimumSellingPrice: number(row.minimum_selling_price),
    grossMarginAmount: number(row.gross_margin_amount),
  }));
  return NextResponse.json({ data, mode: "live" });
}
