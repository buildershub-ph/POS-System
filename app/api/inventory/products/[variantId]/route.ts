import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, supabaseRest } from "@/lib/supabase-server";

export async function PATCH(request: NextRequest, context: { params: Promise<{ variantId: string }> }) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!["owner", "manager", "stock_employee"].includes(user.role ?? "")) {
    return NextResponse.json({ error: "Your role cannot update product photographs." }, { status: 403 });
  }
  const { variantId } = await context.params;
  const body = await request.json() as { photoPath?: string };
  if (!body.photoPath?.trim()) return NextResponse.json({ error: "Photo path is required." }, { status: 400 });

  const response = await supabaseRest(request, "rpc/update_variant_photo", {
    method: "POST",
    body: JSON.stringify({ p_variant_id: variantId, p_photo_path: body.photoPath, p_actor_id: user.id }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : "Product photograph could not be saved.";
    return NextResponse.json({ error: message }, { status: response.status });
  }
  return NextResponse.json({ data: { variantId, photoPath: body.photoPath } });
}
