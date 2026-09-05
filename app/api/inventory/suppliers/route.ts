import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, supabaseRest } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!["owner", "manager"].includes(user.role ?? "")) {
    return NextResponse.json({ error: "Only an owner or manager can add suppliers." }, { status: 403 });
  }

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Supplier name is required." }, { status: 400 });
  const code = `SUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const response = await supabaseRest(request, "suppliers?select=id,code,name", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ code, name, active: true }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: "Supplier could not be added.", details: result }, { status: response.status });
  return NextResponse.json({ data: result[0] }, { status: 201 });
}
