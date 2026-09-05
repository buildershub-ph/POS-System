"use client";

import Link from "next/link";
import { useInventory } from "@/lib/use-inventory";
import { ProductArtwork } from "./product-artwork";

export function Dashboard() {
  const { products } = useInventory();
  const draftIncoming = products.filter((product) => product.receiptStatus === "draft");
  const totalUnits = products.reduce((sum, product) => sum + product.available, 0);
  const incomingUnits = products.reduce((sum, product) => sum + (product.incoming ?? 0), 0);
  const invoiceCount = new Set(products.map((product) => product.sourceInvoice).filter(Boolean)).size;

  return (
    <div className="dashboard-grid">
      <section className="welcome-panel">
        <div><p className="eyebrow">Initial inventory setup</p><h2>Your first order is loaded.</h2><p>Review the imported draft receipts before making stock available for sale.</p><div className="welcome-actions"><Link className="button button--primary" href="/receive">Review Draft Receipts</Link><Link className="button button--light" href="/inventory">Browse Products</Link></div></div>
        <div className="welcome-visual"><span>▤</span><i>✓</i></div>
      </section>

      <section className="metric-grid"><article><span className="metric-icon metric-icon--yellow">▣</span><div><small>Imported variants</small><strong>{products.length}</strong><p>Across {new Set(products.map((product) => product.category)).size} categories</p></div></article><article><span className="metric-icon metric-icon--green">✓</span><div><small>Total units available</small><strong>{totalUnits}</strong><p>Nothing posts until receipt confirmation</p></div></article><article><span className="metric-icon metric-icon--amber">↧</span><div><small>Draft incoming units</small><strong>{incomingUnits.toLocaleString("en-PH")}</strong><p>Across {invoiceCount} proforma invoices</p></div></article></section>

      <section className="dashboard-card dashboard-card--wide"><div className="section-heading"><div><p className="eyebrow">Quick actions</p><h2>What would you like to do?</h2></div></div><div className="quick-action-grid"><Link href="/receive"><span>↧</span><strong>Receive stock</strong><small>Record a supplier delivery</small></Link><Link href="/scan"><span>⌗</span><strong>Scan product</strong><small>Find exact availability</small></Link><Link href="/inventory"><span>▣</span><strong>Browse inventory</strong><small>Search by category or SKU</small></Link><Link href="/cashier"><span>▤</span><strong>Open cashier</strong><small>Prepare a negotiated sale</small></Link></div></section>

      <section className="dashboard-card dashboard-card--wide"><div className="section-heading"><div><p className="eyebrow">Needs confirmation</p><h2>Draft incoming stock</h2></div><Link href="/inventory">View all {draftIncoming.length}</Link></div><div className="attention-list">{draftIncoming.slice(0, 8).map((product) => <Link href={`/inventory/${product.productSlug}?variant=${product.id}`} key={product.id}><ProductArtwork alt={product.photoAlt} kind={product.photo} /><span><strong>{product.productName}</strong><small>{product.sku} · {product.sourceInvoice}</small></span><b>{product.incoming} ordered</b><i>›</i></Link>)}</div></section>
    </div>
  );
}
