"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatPeso } from "@/lib/mock-data";
import type { ProductVariant } from "@/lib/types";
import { useCurrentUser } from "@/lib/use-current-user";
import { useInventory } from "@/lib/use-inventory";
import { ProductArtwork } from "./product-artwork";
import { StockBadge } from "./stock-badge";

type CartLine = {
  product: ProductVariant;
  quantity: number;
  actualPrice: number;
};

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function CashierMode() {
  const { user } = useCurrentUser();
  const { categories, products } = useInventory();
  const [query, setQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [category, setCategory] = useState("All");
  const [mobileTab, setMobileTab] = useState<"products" | "cart">("products");
  const [cart, setCart] = useState<CartLine[]>([]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    const term = query.trim().toLowerCase();
    const readyForSale = product.availability === "stocked" && product.srp != null && product.available > 0;
    return readyForSale && (category === "All" || product.category === category) && (!term || [product.productName, product.sku, product.barcode].join(" ").toLowerCase().includes(term));
  }), [category, products, query]);

  const totals = useMemo(() => {
    const srp = cart.reduce((sum, line) => sum + (line.product.srp ?? 0) * line.quantity, 0);
    const total = cart.reduce((sum, line) => sum + line.actualPrice * line.quantity, 0);
    return { srp, total, discount: srp - total };
  }, [cart]);

  function addProduct(product: ProductVariant) {
    if (product.availability === "display_only") {
      setScanMessage(`${product.productName} is a display-only item — it's available by order, not on hand to sell now.`);
      return;
    }
    const actualPrice = product.srp;
    if (actualPrice == null || product.available <= 0) return;
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { product, quantity: 1, actualPrice }];
    });
  }

  function lookupScan(code: string) {
    const normalized = code.trim().toLowerCase();
    if (!normalized) return;
    const match = products.find((product) => product.barcode.toLowerCase() === normalized || product.sku.toLowerCase() === normalized || product.supplierSku?.toLowerCase() === normalized);
    if (!match) {
      setScanMessage(`No product found for "${code}".`);
      return;
    }
    if (match.availability === "display_only") {
      setScanMessage(`${match.productName} · display only — available by order, not in stock.`);
      return;
    }
    if (match.available <= 0) {
      setScanMessage(`${match.productName} is out of stock (0 available).`);
      return;
    }
    setScanMessage(`${match.productName} · ${match.available} available.`);
    addProduct(match);
    setScanCode("");
  }

  function updateLine(id: string, change: Partial<Pick<CartLine, "quantity" | "actualPrice">>) {
    setCart((current) => current.map((line) => line.product.id === id ? { ...line, ...change } : line));
  }

  const displayName = user.fullName || user.email || "Cashier";

  return (
    <div className="cashier-page">
      <header className="cashier-header">
        <div><Link className="brand" href="/"><span className="brand__mark"><span>BH</span></span><span className="brand__name">BUILDERS <strong>HUB</strong></span></Link><span className="cashier-mode-label">Cashier Mode</span></div>
        <div><span className="cashier-user"><i>{initials(displayName)}</i><span><strong>{displayName}</strong><small>{user.role === "cashier" ? "Cashier" : user.role.replaceAll("_", " ")}</small></span></span><Link className="button button--secondary button--small" href="/">Exit Cashier</Link></div>
      </header>

      <div className="cashier-tabs"><button className={mobileTab === "products" ? "is-active" : ""} onClick={() => setMobileTab("products")}>Products</button><button className={mobileTab === "cart" ? "is-active" : ""} onClick={() => setMobileTab("cart")}>Current Sale <span>{cart.length}</span></button></div>

      <main className="cashier-workspace">
        <section className={`cashier-products ${mobileTab !== "products" ? "cashier-mobile-hidden" : ""}`}>
          <form onSubmit={(event) => { event.preventDefault(); lookupScan(scanCode); }}>
            <label className="search-field search-field--large">
              <span>⌗</span>
              <input
                aria-label="Scan barcode or enter SKU"
                onChange={(event) => setScanCode(event.target.value)}
                placeholder="Scan barcode or enter SKU to check stock or add to sale"
                value={scanCode}
              />
            </label>
          </form>
          {scanMessage && <p className="scan-inline-message">{scanMessage}</p>}
          <label className="search-field"><span>⌕</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Search products by name, SKU or barcode" value={query} /></label>
          <div className="chip-row chip-row--compact">{categories.map((item) => <button className={category === item ? "is-active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="cashier-section-title"><h2>Products</h2><select aria-label="Sort products"><option>Relevance</option><option>Recently sold</option><option>Favourites</option></select></div>
          <div className="cashier-product-grid">{filteredProducts.map((product) => (
            <button className="cashier-product-card" key={product.id} onClick={() => addProduct(product)}>
              <ProductArtwork alt={product.photoAlt} kind={product.photo} />
              <span><strong>{product.productName}</strong><small>{product.color ?? product.model} · {product.size ?? product.model}</small><small>SKU: {product.sku}</small><b>{formatPeso(product.srp)} <i>/ {product.sellingUnit.replaceAll("_", " ")}</i></b><StockBadge compact product={product} /></span>
            </button>
          ))}</div>
          {!filteredProducts.length && <div className="empty-state"><span>↧</span><h3>No products are ready for sale yet</h3><p>Confirm receiving and add SRPs before using Cashier Mode.</p></div>}
        </section>

        <section className={`cashier-cart ${mobileTab !== "cart" ? "cashier-mobile-hidden" : ""}`}>
          <div className="sale-heading"><div><p className="eyebrow">Current transaction</p><h2>New sale</h2></div><div><select aria-label="Customer"><option>Walk-in Customer</option><option>Contractor Account</option></select><button className="button button--secondary button--small">Add Customer</button></div></div>
          <div className="cart-table"><div className="cart-table__header"><span>Item</span><span>Qty</span><span>SRP</span><span>Actual price</span><span>Total</span></div>{cart.map((line, index) => (
            <div className="cart-line" key={line.product.id}>
              <span className="cart-index">{index + 1}</span><ProductArtwork alt={line.product.photoAlt} kind={line.product.photo} />
              <div className="cart-line__name"><strong>{line.product.productName}</strong><small>{line.product.color ?? line.product.model} · {line.product.size ?? line.product.model}</small><small>SKU: {line.product.sku}</small></div>
              <label><span className="mobile-only">Quantity</span><input min="1" onChange={(event) => updateLine(line.product.id, { quantity: Number(event.target.value) })} type="number" value={line.quantity} /><small>{line.product.sellingUnit.replaceAll("_", " ")}</small></label>
              <span className="cart-line__srp">{formatPeso(line.product.srp)}</span>
              <label><span className="mobile-only">Actual price</span><input aria-label={`Actual selling price for ${line.product.productName}`} onChange={(event) => updateLine(line.product.id, { actualPrice: Number(event.target.value) })} type="number" value={line.actualPrice} />{line.actualPrice < (line.product.srp ?? 0) && <small className="approval-note">Approval checked on complete</small>}</label>
              <strong className="cart-line__total">{formatPeso(line.actualPrice * line.quantity)}</strong>
              <button className="cart-remove" aria-label={`Remove ${line.product.productName}`} onClick={() => setCart((current) => current.filter((item) => item.product.id !== line.product.id))}>×</button>
            </div>
          ))}</div>
          <button className="add-note">＋ Add transaction note</button>
          <div className="cart-footer"><label className="field"><span>Discount reason</span><select><option>Customer negotiation</option><option>Contractor pricing</option><option>Promotional discount</option><option>Damaged packaging</option></select></label><div className="cart-totals"><div><span>Subtotal at SRP</span><strong>{formatPeso(totals.srp)}</strong></div><div><span>Discount</span><strong>-{formatPeso(totals.discount)}</strong></div><div><span>Total</span><strong>{formatPeso(totals.total)}</strong></div></div></div>
          <div className="cashier-actions"><button className="button button--secondary">Hold Sale</button><button className="button button--secondary">Save as Quotation</button><button className="button button--primary">Complete Sale</button></div>
        </section>
      </main>

      <button className="mobile-cart-summary" onClick={() => setMobileTab("cart")}><span>{cart.length} item types</span><strong>{formatPeso(totals.total)}</strong><span>View cart ›</span></button>
    </div>
  );
}
