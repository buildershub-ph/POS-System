import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";

export async function POST(request: NextRequest, context: { params: Promise<{ saleId: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!["owner", "manager"].includes(user.role ?? "")) {
    return NextResponse.json({ error: "Only an owner or manager can cancel a sale." }, { status: 403 });
  }

  const { saleId } = await context.params;
  const response = await supabaseRest(request, "rpc/cancel_sale", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ p_sale: { saleId, actorId: user.id } }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : "Sale could not be cancelled.";
    return NextResponse.json({ error: message }, { status: response.status });
  }
  return NextResponse.json({ data: result });
}
