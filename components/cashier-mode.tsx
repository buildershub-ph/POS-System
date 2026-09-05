"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatPeso, invoiceNumber } from "@/lib/mock-data";
import type { CreateSaleInput, PaymentMethod, ProductVariant } from "@/lib/types";
import { useCurrentUser } from "@/lib/use-current-user";
import { useInventory } from "@/lib/use-inventory";
import { ProductArtwork } from "./product-artwork";
import { StockBadge } from "./stock-badge";

type CartLine = {
  product: ProductVariant;
  quantity: number;
  actualPrice: number;
};

type SaleStatusToPost = "held" | "quotation" | "completed";

const paymentMethods: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "split", label: "Split payment" },
];

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function CashierMode() {
  const { user } = useCurrentUser();
  const { categories, products, refetch } = useInventory();
  const [query, setQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [category, setCategory] = useState("All");
  const [mobileTab, setMobileTab] = useState<"products" | "cart">("products");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [discountReason, setDiscountReason] = useState("Customer negotiation");
  const [notes, setNotes] = useState("");
  const [showNoteField, setShowNoteField] = useState(false);
  const [saving, setSaving] = useState<SaleStatusToPost | null>(null);
  const [saleError, setSaleError] = useState("");
  const [saleMessage, setSaleMessage] = useState("");

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

  const hasDiscount = cart.some((line) => line.actualPrice < (line.product.srp ?? 0));

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

  async function submitSale(status: SaleStatusToPost) {
    if (!cart.length) return;
    const missingLocation = cart.find((line) => !line.product.locationId);
    if (missingLocation) {
      setSaleError(`${missingLocation.product.productName} has no storage location on record — it can't be sold until that's fixed.`);
      return;
    }
    setSaving(status);
    setSaleError("");
    setSaleMessage("");
    try {
      const payload: CreateSaleInput = {
        status,
        customerName,
        paymentMethod,
        notes: notes || undefined,
        lines: cart.map((line) => ({
          variantId: line.product.id,
          locationId: line.product.locationId!,
          quantity: line.quantity,
          sellingUnit: line.product.sellingUnit,
          originalSrp: line.product.srp ?? line.actualPrice,
          actualSellingPrice: line.actualPrice,
          discountReason: line.actualPrice < (line.product.srp ?? 0) ? discountReason : undefined,
        })),
      };
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sale could not be posted.");

      const label = status === "completed" ? "Sale" : status === "held" ? "Held sale" : "Quotation";
      setSaleMessage(`${label} ${invoiceNumber(result.data.saleNumber)} saved${status === "completed" ? " — stock updated." : "."}`);
      setCart([]);
      setNotes("");
      setShowNoteField(false);
      if (status === "completed") refetch();
    } catch (reason) {
      setSaleError(reason instanceof Error ? reason.message : "Sale could not be posted.");
    } finally {
      setSaving(null);
    }
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
          <div className="sale-heading"><div><p className="eyebrow">Current transaction</p><h2>New sale</h2></div><div><select aria-label="Customer" onChange={(event) => setCustomerName(event.target.value)} value={customerName}><option>Walk-in Customer</option><option>Contractor Account</option></select></div></div>
          <div className="cart-table"><div className="cart-table__header"><span>Item</span><span>Qty</span><span>SRP</span><span>Actual price</span><span>Total</span></div>{cart.map((line, index) => (
            <div className="cart-line" key={line.product.id}>
              <span className="cart-index">{index + 1}</span><ProductArtwork alt={line.product.photoAlt} kind={line.product.photo} />
              <div className="cart-line__name"><strong>{line.product.productName}</strong><small>{line.product.color ?? line.product.model} · {line.product.size ?? line.product.model}</small><small>SKU: {line.product.sku}</small></div>
              <label><span className="mobile-only">Quantity</span><input max={line.product.available} min="1" onChange={(event) => updateLine(line.product.id, { quantity: Math.min(Number(event.target.value) || 1, line.product.available) })} type="number" value={line.quantity} /><small>{line.product.sellingUnit.replaceAll("_", " ")}</small></label>
              <span className="cart-line__srp">{formatPeso(line.product.srp)}</span>
              <label><span className="mobile-only">Actual price</span><input aria-label={`Actual selling price for ${line.product.productName}`} min="0" onChange={(event) => updateLine(line.product.id, { actualPrice: Math.max(0, Number(event.target.value)) })} type="number" value={line.actualPrice} />{line.actualPrice < (line.product.srp ?? 0) && <small className="approval-note">{user.role === "owner" || user.role === "manager" ? "Discount auto-approved" : "Needs owner/manager approval"}</small>}</label>
              <strong className="cart-line__total">{formatPeso(line.actualPrice * line.quantity)}</strong>
              <button className="cart-remove" aria-label={`Remove ${line.product.productName}`} onClick={() => setCart((current) => current.filter((item) => item.product.id !== line.product.id))}>×</button>
            </div>
          ))}</div>
          {!cart.length && <div className="empty-state"><span>▤</span><h3>Cart is empty</h3><p>Scan a barcode or tap a product to add it.</p></div>}
          <button className="add-note" onClick={() => setShowNoteField((value) => !value)} type="button">＋ Add transaction note</button>
          {showNoteField && <label className="field"><span>Note</span><textarea onChange={(event) => setNotes(event.target.value)} placeholder="Anything worth recording about this sale…" value={notes} /></label>}
          <div className="cart-footer">
            <div>
              <label className="field"><span>Payment method</span><select onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} value={paymentMethod}>{paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
              {hasDiscount && <label className="field"><span>Discount reason</span><select onChange={(event) => setDiscountReason(event.target.value)} value={discountReason}><option>Customer negotiation</option><option>Contractor pricing</option><option>Promotional discount</option><option>Damaged packaging</option></select></label>}
            </div>
            <div className="cart-totals"><div><span>Subtotal at SRP</span><strong>{formatPeso(totals.srp)}</strong></div><div><span>Discount</span><strong>-{formatPeso(totals.discount)}</strong></div><div><span>Total</span><strong>{formatPeso(totals.total)}</strong></div></div>
          </div>
          {saleError && <div className="error-banner">{saleError}</div>}
          {saleMessage && <div className="success-banner"><span>✓</span><p>{saleMessage}</p></div>}
          <div className="cashier-actions">
            <button className="button button--secondary" disabled={!cart.length || saving !== null} onClick={() => submitSale("held")} type="button">{saving === "held" ? "Holding…" : "Hold Sale"}</button>
            <button className="button button--secondary" disabled={!cart.length || saving !== null} onClick={() => submitSale("quotation")} type="button">{saving === "quotation" ? "Saving…" : "Save as Quotation"}</button>
            <button className="button button--primary" disabled={!cart.length || saving !== null} onClick={() => submitSale("completed")} type="button">{saving === "completed" ? "Completing…" : "Complete Sale"}</button>
          </div>
        </section>
      </main>

      <button className="mobile-cart-summary" onClick={() => setMobileTab("cart")}><span>{cart.length} item types</span><strong>{formatPeso(totals.total)}</strong><span>View cart ›</span></button>
    </div>
  );
}
