import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import type { CustomerSummary } from "@/lib/types";

type CustomerSummaryRow = {
  id: string;
  name: string;
  phone: string | null;
  completed_orders: number | string;
  total_spent: number | string;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ data: [] as CustomerSummary[] });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const response = await supabaseRest(request, "customer_purchase_summary?select=*&order=total_spent.desc&limit=500");
  if (!response.ok) return NextResponse.json({ error: "Unable to load customers." }, { status: response.status });
  const rows = (await response.json()) as CustomerSummaryRow[];
  const data: CustomerSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone ?? undefined,
    completedOrders: Number(row.completed_orders ?? 0),
    totalSpent: Number(row.total_spent ?? 0),
    firstPurchaseAt: row.first_purchase_at ?? undefined,
    lastPurchaseAt: row.last_purchase_at ?? undefined,
  }));
  return NextResponse.json({ data });
}
