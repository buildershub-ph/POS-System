import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import { invoiceNumber } from "@/lib/mock-data";
import type { PaymentMethod, SaleStatus } from "@/lib/types";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

type ExportRow = {
  sale_number: number;
  status: SaleStatus;
  customer_name: string | null;
  customer_contact_number: string | null;
  payment_method: PaymentMethod | null;
  created_at: string;
  completed_at: string | null;
  total_amount: number | string;
  total_srp: number | string;
  downpayment_amount: number | string;
  balance_due: number | string;
  balance_paid_at: string | null;
  balance_payment_method: PaymentMethod | null;
  created_by_name: string | null;
  completed_by_name: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  notes: string | null;
  line_items: Array<{
    customItemName: string | null;
    productName: string | null;
    sku: string | null;
    quantity: number | string;
    actualSellingPrice: number | string;
  }>;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "A from and to date are required." }, { status: 400 });

  const fromIso = `${from}T00:00:00`;
  const toDate = new Date(`${to}T00:00:00`);
  toDate.setDate(toDate.getDate() + 1);
  const toIso = toDate.toISOString().slice(0, 19);

  const response = await supabaseRest(
    request,
    `sales_overview?select=*&created_at=gte.${fromIso}&created_at=lt.${toIso}&order=created_at.asc&limit=10000`,
  );
  if (!response.ok) return NextResponse.json({ error: "Export failed." }, { status: response.status });
  const rows = (await response.json()) as ExportRow[];

  const headers = [
    "Invoice", "Status", "Date", "Customer", "Contact Number", "Items", "Payment Method",
    "Total Amount", "Total SRP", "Downpayment", "Balance Due", "Balance Paid On", "Balance Payment Method",
    "Sold By", "Completed By", "Cancelled By", "Cancelled At", "Notes",
  ];
  const body = rows.map((row) => {
    const items = (row.line_items ?? [])
      .map((line) => `${line.productName ?? line.customItemName ?? "item"} x${line.quantity}`)
      .join("; ");
    return [
      invoiceNumber(row.sale_number),
      row.status,
      row.created_at,
      row.customer_name ?? "",
      row.customer_contact_number ?? "",
      items,
      row.payment_method ?? "",
      Number(row.total_amount ?? 0).toFixed(2),
      Number(row.total_srp ?? 0).toFixed(2),
      Number(row.downpayment_amount ?? 0).toFixed(2),
      Number(row.balance_due ?? 0).toFixed(2),
      row.balance_paid_at ?? "",
      row.balance_payment_method ?? "",
      row.created_by_name ?? "",
      row.completed_by_name ?? "",
      row.cancelled_by_name ?? "",
      row.cancelled_at ?? "",
      row.notes ?? "",
    ]
      .map(csvCell)
      .join(",");
  });
  const csv = [headers.map(csvCell).join(","), ...body].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="builders-hub-transactions-${from}-to-${to}.csv"`,
    },
  });
}
