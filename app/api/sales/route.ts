import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { can } from "@/lib/permissions";
import { authenticateRequest, isSupabaseConfigured, supabaseRest } from "@/lib/supabase-server";
import type { CreateSaleInput, PaymentMethod, SaleLineRecord, SaleRecord, SaleStatus } from "@/lib/types";

type SalesOverviewRow = {
  id: string;
  sale_number: number;
  status: SaleStatus;
  customer_name: string | null;
  customer_contact_number: string | null;
  payment_method: PaymentMethod | null;
  notes: string | null;
  inventory_transaction_id: string | null;
  created_at: string;
  completed_at: string | null;
  total_amount: number | string;
  total_srp: number | string;
  line_count: number | string;
  downpayment_amount: number | string;
  balance_paid_at: string | null;
  balance_due: number | string;
  balance_payment_method: PaymentMethod | null;
  created_by_name: string | null;
  completed_by_name: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  payment_status: "paid" | "pending";
  paid_at: string | null;
  paid_by_name: string | null;
  customer_id: string | null;
  line_items: Array<{
    variantId: string | null;
    customItemName: string | null;
    customSku: string | null;
    quantity: number | string;
    sellingUnit: SaleLineRecord["sellingUnit"];
    originalSrp: number | string;
    actualSellingPrice: number | string;
    discountReason: string | null;
    productName: string | null;
    sku: string | null;
  }>;
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSaleRecord(row: SalesOverviewRow): SaleRecord {
  return {
    id: row.id,
    saleNumber: row.sale_number,
    status: row.status,
    customerName: row.customer_name ?? undefined,
    customerContactNumber: row.customer_contact_number ?? undefined,
    paymentMethod: row.payment_method ?? undefined,
    notes: row.notes ?? undefined,
    inventoryTransactionId: row.inventory_transaction_id ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    totalAmount: number(row.total_amount),
    totalSrp: number(row.total_srp),
    lineCount: number(row.line_count),
    downpaymentAmount: number(row.downpayment_amount),
    balanceDue: number(row.balance_due),
    balancePaidAt: row.balance_paid_at ?? undefined,
    balancePaymentMethod: row.balance_payment_method ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    completedByName: row.completed_by_name ?? undefined,
    cancelledByName: row.cancelled_by_name ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    paymentStatus: row.payment_status,
    paidAt: row.paid_at ?? undefined,
    paidByName: row.paid_by_name ?? undefined,
    customerId: row.customer_id ?? undefined,
    lines: (row.line_items ?? []).map((line) => ({
      variantId: line.variantId ?? undefined,
      customItemName: line.customItemName ?? undefined,
      customSku: line.customSku ?? undefined,
      quantity: number(line.quantity),
      sellingUnit: line.sellingUnit,
      originalSrp: number(line.originalSrp),
      actualSellingPrice: number(line.actualSellingPrice),
      discountReason: line.discountReason ?? undefined,
      productName: line.productName ?? undefined,
      sku: line.sku ?? undefined,
    })),
  };
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ data: [] as SaleRecord[], mode: "demo" });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const response = await supabaseRest(request, "sales_overview?select=*&order=created_at.desc&limit=200");
  if (!response.ok) return NextResponse.json({ error: "Unable to load transactions." }, { status: response.status });
  const rows = (await response.json()) as SalesOverviewRow[];
  return NextResponse.json({ data: rows.map(toSaleRecord) });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!can(user.role ?? "cashier", "processSale")) {
    return NextResponse.json({ error: "Your role cannot process sales." }, { status: 403 });
  }

  const body = (await request.json()) as CreateSaleInput;
  if (!body.customerName?.trim()) return NextResponse.json({ error: "Customer full name is required." }, { status: 400 });
  if (!body.lines?.length) return NextResponse.json({ error: "A sale needs at least one item." }, { status: 400 });
  const invalidLine = body.lines.find((line) => !line.variantId && !line.customItemName?.trim());
  if (invalidLine) return NextResponse.json({ error: "Every line needs either a catalogue product or a custom item name." }, { status: 400 });

  const response = await supabaseRest(request, "rpc/create_sale", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ p_sale: { ...body, actorId: user.id } }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : "Sale could not be posted.";
    return NextResponse.json({ error: message }, { status: response.status });
  }
  return NextResponse.json({ data: result }, { status: 201 });
}
