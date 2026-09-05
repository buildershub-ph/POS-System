import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ProductDetail } from "@/components/product-detail";

export const metadata: Metadata = {
  title: "Product Details | Builders Hub",
};

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AppShell eyebrow="Inventory / Product" title="Product Details" headerAction={<Link className="button button--secondary button--small" href="/inventory">← Inventory</Link>}><ProductDetail slug={slug} /></AppShell>;
}

