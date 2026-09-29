import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import { invoiceNumber } from "@/lib/mock-data";
import { buildProfitLossLines, itemTypeLabels, type ProfitLossItemType, type ProfitLossSaleInput } from "@/lib/profit-loss";

type SaleRow = {
  id: string;
  sale_number: number;
  created_at: string;
  customer_name: string | null;
  // select=* like the other sales routes, so a database that hasn't run
  // every migration yet still loads -- these two may be absent.
  payment_status?: "paid" | "pending" | null;
  total_discount_amount?: number | string | null;
  line_items: Array<{
    variantId: string | null;
    customItemName: string | null;
    productName: string | null;
    sku: string | null;
    quantity: number | string;
    actualSellingPrice: number | string;
  }> | null;
};

type CostRow = {
  variant_id: string;
  unit_cost: number | string;
  landed_cost: number | string;
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function supabaseError(response: Response) {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? "";
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// Owner-only, same as every other place cost data is exposed. Only completed
// sales count -- held/quotation sales haven't happened yet and cancelled
// sales were reversed.
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (user.role !== "owner") {
    return NextResponse.json({ error: "Only an owner can view the profit and loss report." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to || !isoDate.test(from) || !isoDate.test(to)) {
    return NextResponse.json({ error: "A from and to date are required." }, { status: 400 });
  }

  // Same date window as the transactions CSV export, so the two agree.
  const fromIso = `${from}T00:00:00`;
  const toDate = new Date(`${to}T00:00:00`);
  toDate.setDate(toDate.getDate() + 1);
  const toIso = toDate.toISOString().slice(0, 19);

  const [salesResponse, costsResponse] = await Promise.all([
    supabaseRest(
      request,
      `sales_overview?select=*&status=eq.completed&created_at=gte.${fromIso}&created_at=lt.${toIso}&order=created_at.asc&limit=10000`,
    ),
    supabaseRest(request, "variant_private_costs?select=variant_id,unit_cost,landed_cost"),
  ]);
  if (!salesResponse.ok) {
    return NextResponse.json({ error: `Unable to load sales. ${await supabaseError(salesResponse)}`.trim() }, { status: salesResponse.status });
  }
  if (!costsResponse.ok) {
    return NextResponse.json({ error: `Unable to load cost data. ${await supabaseError(costsResponse)}`.trim() }, { status: costsResponse.status });
  }

  const saleRows = (await salesResponse.json()) as SaleRow[];
  const costRows = (await costsResponse.json()) as CostRow[];

  // Landed cost (purchase price plus freight etc.) is the true cost of goods;
  // fall back to the unit cost if a landed cost was never filled in.
  const costs = new Map(costRows.map((row) => [row.variant_id, number(row.landed_cost) || number(row.unit_cost)]));
  const sales: ProfitLossSaleInput[] = saleRows.map((row) => ({
    id: row.id,
    saleNumber: row.sale_number,
    createdAt: row.created_at,
    customerName: row.customer_name,
    paymentStatus: row.payment_status ?? null,
    totalDiscountAmount: number(row.total_discount_amount),
    lines: (row.line_items ?? []).map((line) => ({
      variantId: line.variantId,
      customItemName: line.customItemName,
      productName: line.productName,
      sku: line.sku,
      quantity: number(line.quantity),
      actualSellingPrice: number(line.actualSellingPrice),
    })),
  }));
  const typeParam = searchParams.get("type");
  const typeFilter: ProfitLossItemType | null = typeParam === "in_stock" || typeParam === "custom" ? typeParam : null;
  const lines = buildProfitLossLines(sales, costs).filter((line) => !typeFilter || line.type === typeFilter);

  if (searchParams.get("format") !== "csv") {
    return NextResponse.json({ data: lines, from, to });
  }

  // One flat row per item sold, so the file can be filtered/pivoted in a
  // spreadsheet (e.g. Type = Custom) and every column still sums correctly.
  const money = (value: number) => value.toFixed(2);
  const rows: unknown[][] = [
    [
      "Date", "Invoice", "Customer", "Payment", "Item", "SKU", "Type", "Qty", "Unit Price",
      "Gross Sales", "Discount", "Net Sales", "Unit Cost", "Cost", "Cost Basis", "Gross Profit", "Margin",
    ],
    ...lines.map((line) => [
      line.createdAt.slice(0, 10),
      invoiceNumber(line.saleNumber),
      line.customerName ?? "",
      line.paymentStatus === "pending" ? "Unpaid" : "Paid",
      line.name,
      line.sku ?? "",
      itemTypeLabels[line.type],
      line.quantity,
      money(line.unitPrice),
      money(line.grossSales),
      money(line.discount),
      money(line.sales),
      money(line.unitCost),
      money(line.cost),
      line.type === "custom" ? "Sold price" : line.missingCost ? "No cost on file" : "Landed cost",
      money(line.grossProfit),
      line.sales > 0 ? `${((line.grossProfit / line.sales) * 100).toFixed(2)}%` : "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="builders-hub-profit-and-loss-${from}-to-${to}${typeFilter ? `-${typeFilter.replace("_", "-")}` : ""}.csv"`,
    },
  });
}
