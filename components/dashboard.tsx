"use client";

import Link from "next/link";
import { useCurrentUser } from "@/lib/use-current-user";
import { useInventory } from "@/lib/use-inventory";
import { ProductArtwork } from "./product-artwork";

export function Dashboard() {
  const { user } = useCurrentUser();
  const { products } = useInventory();
  const draftIncoming = products.filter((product) => product.receiptStatus === "draft");
  const lowStock = products.filter((product) => product.availability === "stocked" && product.available > 0 && product.available <= product.reorderLevel);
  const outOfStock = products.filter((product) => product.availability === "stocked" && product.available <= 0);
  const displayOnly = products.filter((product) => product.availability === "display_only");
  const totalUnits = products.reduce((sum, product) => sum + product.available, 0);
  const displayName = user.fullName || "there";

  return (
    <div className="dashboard-grid">
      <section className="welcome-panel">
        <div><p className="eyebrow">Builders Hub inventory</p><h2>Welcome back, {displayName.split(" ")[0]}.</h2><p>Search the catalogue, scan a barcode, receive stock, or open Cashier Mode.</p><div className="welcome-actions"><Link className="button button--primary" href="/inventory">Browse Inventory</Link><Link className="button button--light" href="/scan">Scan a product</Link></div></div>
        <div className="welcome-visual"><span>▤</span><i>✓</i></div>
      </section>

      <section className="metric-grid">
        <article><span className="metric-icon metric-icon--yellow">▣</span><div><small>Product variants</small><strong>{products.length}</strong><p>Across {new Set(products.map((product) => product.category)).size} categories</p></div></article>
        <article><span className="metric-icon metric-icon--green">✓</span><div><small>Total units on hand</small><strong>{totalUnits.toLocaleString("en-PH")}</strong><p>{outOfStock.length} variant(s) out of stock</p></div></article>
        <article><span className="metric-icon metric-icon--amber">!</span><div><small>Low stock</small><strong>{lowStock.length}</strong><p>At or below reorder level</p></div></article>
      </section>

      <section className="dashboard-card dashboard-card--wide"><div className="section-heading"><div><p className="eyebrow">Quick actions</p><h2>What would you like to do?</h2></div></div><div className="quick-action-grid"><Link href="/receive"><span>↧</span><strong>Receive stock</strong><small>Record a supplier delivery</small></Link><Link href="/scan"><span>⌗</span><strong>Scan product</strong><small>Find exact availability</small></Link><Link href="/inventory"><span>▣</span><strong>Browse inventory</strong><small>Search by category or SKU</small></Link><Link href="/cashier"><span>▤</span><strong>Open cashier</strong><small>Prepare a negotiated sale</small></Link></div></section>

      {lowStock.length > 0 && (
        <section className="dashboard-card dashboard-card--wide"><div className="section-heading"><div><p className="eyebrow">Needs reordering</p><h2>Low stock ({lowStock.length})</h2></div><Link href="/inventory?view=low-stock">View all {lowStock.length}</Link></div><div className="attention-list">{lowStock.slice(0, 8).map((product) => <Link href={`/inventory/${product.productSlug}?variant=${product.id}`} key={product.id}><ProductArtwork alt={product.photoAlt} kind={product.photo} /><span><strong>{product.productName}</strong><small>{product.sku} · reorder level {product.reorderLevel}</small></span><b>{product.available} left</b><i>›</i></Link>)}</div></section>
      )}

      {draftIncoming.length > 0 && (
        <section className="dashboard-card dashboard-card--wide"><div className="section-heading"><div><p className="eyebrow">Needs confirmation</p><h2>Draft incoming stock</h2></div><Link href="/inventory">View all {draftIncoming.length}</Link></div><div className="attention-list">{draftIncoming.slice(0, 8).map((product) => <Link href={`/inventory/${product.productSlug}?variant=${product.id}`} key={product.id}><ProductArtwork alt={product.photoAlt} kind={product.photo} /><span><strong>{product.productName}</strong><small>{product.sku} · {product.sourceInvoice}</small></span><b>{product.incoming} ordered</b><i>›</i></Link>)}</div></section>
      )}

      {displayOnly.length > 0 && (
        <section className="dashboard-card dashboard-card--wide"><div className="section-heading"><div><p className="eyebrow">Showroom only</p><h2>Display-only items ({displayOnly.length})</h2></div><Link href="/inventory">View inventory</Link></div><div className="attention-list">{displayOnly.slice(0, 8).map((product) => <Link href={`/inventory/${product.productSlug}?variant=${product.id}`} key={product.id}><ProductArtwork alt={product.photoAlt} kind={product.photo} /><span><strong>{product.productName}</strong><small>{product.sku} · available by order only</small></span><i>›</i></Link>)}</div></section>
      )}
    </div>
  );
}
