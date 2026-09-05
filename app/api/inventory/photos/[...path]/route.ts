import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, supabaseStorage } from "@/lib/supabase-server";

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { path } = await context.params;
  const objectPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const response = await supabaseStorage(request, `product-photos/${objectPath}`);
  if (!response.ok) return NextResponse.json({ error: "Photograph not found." }, { status: response.status });
  return new NextResponse(await response.arrayBuffer(), {
    headers: {
      "content-type": response.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}
