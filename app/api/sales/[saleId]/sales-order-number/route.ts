import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { can } from "@/lib/permissions";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";

// Records the Sales Order number from the store's paper receipt against a
// sale. A blank value clears it.
export async function POST(request: NextRequest, context: { params: Promise<{ saleId: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!can(user.role ?? "cashier", "processSale")) {
    return NextResponse.json({ error: "Your role cannot process sales." }, { status: 403 });
  }

  const { saleId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { salesOrderNumber?: string };
  const salesOrderNumber = String(body.salesOrderNumber ?? "").trim();
  if (salesOrderNumber.length > 50) {
    return NextResponse.json({ error: "The SO number is too long." }, { status: 400 });
  }

  const response = await supabaseRest(request, "rpc/set_sales_order_number", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ p_sale: { saleId, salesOrderNumber, actorId: user.id } }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : "The SO number could not be saved.";
    return NextResponse.json({ error: message }, { status: response.status });
  }
  return NextResponse.json({ data: result });
}
