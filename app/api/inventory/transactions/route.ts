import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import { InventoryRuleError, validateInventoryTransaction } from "@/lib/inventory-ledger";
import type { InventoryTransactionInput } from "@/lib/types";

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  try {
    const body = (await request.json()) as InventoryTransactionInput & {
      deliveryReference?: string;
      sourceInvoice?: string;
      supersedesDraftId?: string;
      reason?: string;
      notes?: string;
    };
    const transaction = validateInventoryTransaction(body);
    if (["receiving", "transfer", "supplier_return", "damaged", "display_stock", "physical_count_adjustment"].includes(transaction.type)
      && !["owner", "manager"].includes(user.role ?? "")) {
      return NextResponse.json({ error: "Your role cannot post this stock transaction." }, { status: 403 });
    }
    const response = await supabaseRest(request, "rpc/post_sites_inventory_transaction", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ p_transaction: { ...body, actorId: user.id } }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof result?.message === "string" ? result.message : "Transaction could not be posted.";
      return NextResponse.json({ error: message }, { status: response.status });
    }
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryRuleError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Invalid transaction request." }, { status: 400 });
  }
}
