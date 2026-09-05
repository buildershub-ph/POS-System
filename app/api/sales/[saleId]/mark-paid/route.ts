import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { can } from "@/lib/permissions";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import type { RecordSalePaymentInput } from "@/lib/types";

export async function POST(request: NextRequest, context: { params: Promise<{ saleId: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!can(user.role ?? "cashier", "processSale")) {
    return NextResponse.json({ error: "Your role cannot process sales." }, { status: 403 });
  }

  const { saleId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as RecordSalePaymentInput;
  if (!body.paymentMethod) return NextResponse.json({ error: "A payment method is required." }, { status: 400 });

  const response = await supabaseRest(request, "rpc/record_sale_payment", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ p_sale: { ...body, saleId, actorId: user.id } }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : "Payment could not be recorded.";
    return NextResponse.json({ error: message }, { status: response.status });
  }
  return NextResponse.json({ data: result });
}
