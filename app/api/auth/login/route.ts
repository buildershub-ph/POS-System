import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 503 });
  }

  const body = (await request.json()) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
  const result = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; msg?: string };
  if (!response.ok || !result.access_token || !result.refresh_token) {
    return NextResponse.json({ error: result.error_description ?? result.msg ?? "Sign in failed." }, { status: 401 });
  }

  const secure = process.env.NODE_ENV === "production";
  const next = NextResponse.json({ ok: true });
  next.cookies.set("bh-access-token", result.access_token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: result.expires_in ?? 3600 });
  next.cookies.set("bh-refresh-token", result.refresh_token, { httpOnly: true, sameSite: "strict", secure, path: "/api/auth", maxAge: 60 * 60 * 24 * 30 });
  return next;
}

