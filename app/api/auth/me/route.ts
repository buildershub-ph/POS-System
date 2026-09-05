import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, isSupabaseConfigured } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    // Demo/offline mode: let the app be browsed without a live login, as the owner.
    return NextResponse.json({
      data: { id: "demo-owner", email: "owner@buildershub.example", fullName: "Demo Owner", role: "owner" },
      mode: "demo",
    });
  }
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json({ data: user, mode: "live" });
}
