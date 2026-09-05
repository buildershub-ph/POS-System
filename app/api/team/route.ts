import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  authenticateRequest,
  isSupabaseConfigured,
  supabaseAdminAuth,
  supabaseAdminRest,
  supabaseRest,
} from "@/lib/supabase-server";
import type { TeamMember, UserRole } from "@/lib/types";

type ProfileRow = { id: string; email: string; full_name: string; role: UserRole; active: boolean };

function toTeamMember(row: ProfileRow): TeamMember {
  return { id: row.id, email: row.email, fullName: row.full_name, role: row.role, active: row.active };
}

function randomPassword() {
  const values = crypto.getRandomValues(new Uint32Array(4));
  return `Bh-${Array.from(values, (value) => value.toString(36).padStart(7, "0")).join("").slice(0, 16)}`;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ data: [] as TeamMember[], mode: "demo" });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Only an owner can view the team list." }, { status: 403 });

  const response = await supabaseRest(request, "profiles?select=id,email,full_name,role,active&order=full_name.asc");
  if (!response.ok) return NextResponse.json({ error: "Unable to load team members." }, { status: response.status });
  const rows = (await response.json()) as ProfileRow[];
  return NextResponse.json({ data: rows.map(toTeamMember) });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Only an owner can add team members." }, { status: 403 });

  const body = (await request.json()) as { email?: string; fullName?: string; role?: UserRole };
  const email = body.email?.trim().toLowerCase();
  const fullName = body.fullName?.trim();
  const role = body.role;
  const validRoles: UserRole[] = ["owner", "manager", "sales_employee", "stock_employee", "cashier"];
  if (!email || !fullName || !role || !validRoles.includes(role)) {
    return NextResponse.json({ error: "Email, full name, and a valid role are required." }, { status: 400 });
  }

  const temporaryPassword = randomPassword();
  const createResponse = await supabaseAdminAuth("users", {
    method: "POST",
    body: JSON.stringify({ email, password: temporaryPassword, email_confirm: true }),
  });
  const createResult = await createResponse.json().catch(() => null);
  if (!createResponse.ok) {
    const message = typeof createResult?.msg === "string" ? createResult.msg
      : typeof createResult?.message === "string" ? createResult.message
      : "Login account could not be created.";
    return NextResponse.json({ error: message }, { status: createResponse.status });
  }
  const authUserId = createResult?.id as string | undefined;
  if (!authUserId) return NextResponse.json({ error: "Login account was created but no ID was returned." }, { status: 502 });

  const profileResponse = await supabaseAdminRest("profiles?select=id,email,full_name,role,active", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ id: authUserId, email, full_name: fullName, role, active: true }),
  });
  const profileResult = await profileResponse.json().catch(() => null);
  if (!profileResponse.ok) {
    return NextResponse.json({ error: "Login account was created, but the team profile could not be saved.", details: profileResult }, { status: profileResponse.status });
  }

  return NextResponse.json({ data: { ...toTeamMember(profileResult[0]), temporaryPassword } }, { status: 201 });
}
