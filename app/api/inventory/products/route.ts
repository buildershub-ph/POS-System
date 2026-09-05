import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, supabaseRest } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!["owner", "manager"].includes(user.role ?? "")) {
    return NextResponse.json({ error: "Only an owner or manager can add products." }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const response = await supabaseRest(request, "rpc/create_catalogue_product", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ p_product: { ...body, actorId: user.id } }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : "Product could not be added.";
    return NextResponse.json({ error: message }, { status: response.status });
  }
  return NextResponse.json({ data: result }, { status: 201 });
}
