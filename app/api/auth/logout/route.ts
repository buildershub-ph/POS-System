import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("bh-access-token", "", { expires: new Date(0), path: "/" });
  response.cookies.set("bh-refresh-token", "", { expires: new Date(0), path: "/api/auth" });
  return response;
}

