import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, supabaseRest } from "@/lib/supabase-server";
import type { UserRole } from "@/lib/types";

const validRoles: UserRole[] = ["owner", "manager", "sales_employee", "stock_employee", "cashier"];

export async function PATCH(request: NextRequest, context: { params: Promise<{ profileId: string }> }) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Only an owner can update team members." }, { status: 403 });

  const { profileId } = await context.params;
  const body = (await request.json()) as { role?: UserRole; active?: boolean };
  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) {
    if (!validRoles.includes(body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    patch.role = body.role;
  }
  if (body.active !== undefined) patch.active = body.active;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  if (profileId === user.id && (patch.active === false || (patch.role && patch.role !== "owner"))) {
    return NextResponse.json({ error: "You cannot remove your own owner access." }, { status: 400 });
  }

  const response = await supabaseRest(request, `profiles?id=eq.${profileId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!response.ok) return NextResponse.json({ error: "Team member could not be updated." }, { status: response.status });
  return NextResponse.json({ ok: true });
}
