import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, supabaseRest } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!["owner", "manager", "stock_employee"].includes(user.role ?? "")) {
    return NextResponse.json({ error: "Your role cannot access supplier setup." }, { status: 403 });
  }

  const [categoriesResponse, locationsResponse, suppliersResponse] = await Promise.all([
    supabaseRest(request, "categories?select=id,code,name&active=eq.true&order=name.asc"),
    supabaseRest(request, "locations?select=id,code,name&active=eq.true&order=name.asc"),
    supabaseRest(request, "suppliers?select=id,code,name&active=eq.true&order=name.asc"),
  ]);
  if (![categoriesResponse, locationsResponse, suppliersResponse].every((response) => response.ok)) {
    return NextResponse.json({ error: "Product setup lists could not be loaded." }, { status: 502 });
  }
  return NextResponse.json({
    data: {
      categories: await categoriesResponse.json(),
      locations: await locationsResponse.json(),
      suppliers: await suppliersResponse.json(),
    },
  });
}
