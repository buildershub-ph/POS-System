import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/favicon.svg", "/manifest.webmanifest", "/og.png"];

function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Without Supabase configured there is nothing to authenticate against, so
  // keep the app browsable in demo/offline mode.
  if (!isSupabaseConfigured()) return NextResponse.next();
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith("/_next"))) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get("bh-access-token")?.value);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|manifest.webmanifest|og.png).*)"],
};
