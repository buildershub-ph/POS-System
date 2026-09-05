"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatPeso } from "@/lib/mock-data";
import { useInventory } from "@/lib/use-inventory";
import { useOwnerMargins } from "@/lib/use-owner-margins";
import { ProductArtwork } from "./product-artwork";
import { StockBadge } from "./stock-badge";
import { BarcodeLabel } from "./barcode-label";

export function ProductDetail({ slug }: { slug: string }) {
  const { products } = useInventory();
  const { margins, isOwner } = useOwnerMargins();
  const variants = useMemo(() => products.filter((product) => product.productSlug === slug), [products, slug]);
  const [selectedId, setSelectedId] = useState(variants[0]?.id ?? "");
  const effectiveSelectedId = variants.some((variant) => variant.id === selectedId) ? selectedId : variants[0]?.id ?? "";
  const product = variants.find((item) => item.id === effectiveSelectedId);

  if (!product) {
    return <div className="empty-state"><h2>Product not found</h2><Link className="button button--primary" href="/inventory">Back to inventory</Link></div>;
  }

  const margin = margins[product.id];

  return (
    <div className="detail-layout">
      <section className="detail-photo-card">
        <ProductArtwork alt={product.photoAlt} kind={product.photo} large />
        <div className="photo-thumbnails"><button className="is-active" aria-label="Main product photo" /><button aria-label="Box label photo placeholder">BOX LABEL</button></div>
      </section>

      <section className="detail-info">
        <div className="detail-info__topline"><span>{product.category}</span><button className="icon-button" aria-label="Add to favourites">☆</button></div>
        <h2>{product.productName}</h2>
        <p className="detail-model">{product.brand} · {product.model}</p>
        <StockBadge product={product} />

        {variants.length > 1 && (
          <label className="field"><span>Exact variant</span><select value={effectiveSelectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.color} · {variant.size} · {variant.available} available</option>)}
          </select></label>
        )}

        <div className="identity-grid"><div><span>Our SKU</span><strong>{product.sku}</strong></div><div><span>Supplier SKU</span><strong>{product.supplierSku ?? "Not recorded"}</strong></div><div><span>Supplier</span><strong>{product.supplierName ?? "Not recorded"}</strong></div></div>
        <BarcodeLabel barcode={product.barcode} sku={product.sku} productName={product.productName} downloadable />
        <div className="price-block"><span>Suggested retail price</span><strong>{formatPeso(product.srp)}</strong>{product.srp != null ? <small>per {product.sellingUnit.replaceAll("_", " ")}</small> : <small>Owner pricing setup required</small>}</div>

        <div className="specification-card"><h3>Specifications</h3>{Object.entries(product.attributes).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="location-card"><span>⌖</span><div><small>Current stock location</small><strong>{product.location}{product.locationCompany && product.locationCompany !== "Builders Hub" ? ` (${product.locationCompany})` : ""}</strong></div></div>
        {isOwner && margin && (
          <div className="specification-card owner-margin-card"><h3>Cost &amp; margin (owner only)</h3>
            <div><span>Unit cost</span><strong>{formatPeso(margin.unitCost)}</strong></div>
            <div><span>Landed cost</span><strong>{formatPeso(margin.landedCost)}</strong></div>
            <div><span>Minimum selling price</span><strong>{formatPeso(margin.minimumSellingPrice)}</strong></div>
            <div><span>Gross margin at SRP</span><strong>{formatPeso(margin.grossMarginAmount)} {product.srp ? `(${((margin.grossMarginAmount / product.srp) * 100).toFixed(1)}%)` : ""}</strong></div>
          </div>
        )}
        <div className="detail-actions"><Link className="button button--secondary" href="/receive">Review draft receipt</Link>{product.srp != null && product.available > 0 ? <Link className="button button--primary" href={`/cashier?variant=${product.id}`}>Add to sale</Link> : <button className="button button--primary" disabled type="button">Not ready for sale</button>}</div>
      </section>
    </div>
  );
}
