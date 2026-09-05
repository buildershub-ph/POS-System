import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import type { SaleHistoryAction, SaleHistoryEntry } from "@/lib/types";

type SaleHistoryRow = {
  id: string;
  sale_id: string;
  action: SaleHistoryAction;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
};

export async function GET(request: NextRequest, context: { params: Promise<{ saleId: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ data: [] as SaleHistoryEntry[] });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { saleId } = await context.params;
  const response = await supabaseRest(request, `sale_history?select=*&sale_id=eq.${saleId}&order=created_at.asc`);
  if (!response.ok) return NextResponse.json({ error: "Unable to load this transaction's history." }, { status: response.status });
  const rows = (await response.json()) as SaleHistoryRow[];
  const data: SaleHistoryEntry[] = rows.map((row) => ({
    id: row.id,
    saleId: row.sale_id,
    action: row.action,
    actorId: row.actor_id ?? undefined,
    actorName: row.actor_name ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  }));
  return NextResponse.json({ data });
}
