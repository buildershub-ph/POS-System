import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateRequest, supabaseStorage } from "@/lib/supabase-server";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!["owner", "manager", "stock_employee"].includes(user.role ?? "")) {
    return NextResponse.json({ error: "Your role cannot upload product photographs." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a product photograph." }, { status: 400 });
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Use a JPG, PNG, or WebP photograph." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Photograph must be 10 MB or smaller." }, { status: 400 });

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const objectPath = `${user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const response = await supabaseStorage(request, `product-photos/${objectPath}`, {
    method: "POST",
    headers: { "content-type": file.type, "x-upsert": "false" },
    body: await file.arrayBuffer(),
  });
  if (!response.ok) return NextResponse.json({ error: "Photograph could not be uploaded." }, { status: response.status });
  return NextResponse.json({ data: { path: objectPath } }, { status: 201 });
}
