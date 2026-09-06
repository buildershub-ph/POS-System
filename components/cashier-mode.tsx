"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatPeso, invoiceNumber, paymentMethods } from "@/lib/mock-data";
import type { CreateSaleInput, DoorSwing, PaymentMethod, ProductVariant } from "@/lib/types";
import { useBarcodeCamera } from "@/lib/use-barcode-camera";
import { useCurrentUser } from "@/lib/use-current-user";
import { useInventory } from "@/lib/use-inventory";
import { ProductArtwork } from "./product-artwork";
import { StockBadge } from "./stock-badge";

type CartLine = {
  product: ProductVariant;
  quantity: number;
  actualPrice: number;
  doorSwing?: DoorSwing;
};

// A custom item is a customer order for something not in the catalogue at
// all -- not stocked, not on display. It's recorded on the sale for
// bookkeeping only; it never touches inventory.
type CustomCartLine = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  actualPrice: number;
};

type SaleStatusToPost = "held" | "quotation" | "completed";

function isPreorder(product: ProductVariant) {
  return product.availability === "display_only" || product.available <= 0;
}

// Every Filhome Builders door needs a left/right swing choice, except the
// jamb itself (there's nothing to swing).
function needsDoorSwing(product: ProductVariant) {
  return product.supplierName === "Filhome Builders" && product.category !== "Door Jamb";
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function CashierMode() {
  const { user } = useCurrentUser();
  const { categories, products, refetch, error: inventoryError } = useInventory();
  const [query, setQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [category, setCategory] = useState("All");
  const [mobileTab, setMobileTab] = useState<"products" | "cart">("products");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customLines, setCustomLines] = useState<CustomCartLine[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customSku, setCustomSku] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customError, setCustomError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [discountReason, setDiscountReason] = useState("Customer negotiation");
  const [notes, setNotes] = useState("");
  const [showNoteField, setShowNoteField] = useState(false);
  const [hasDownpayment, setHasDownpayment] = useState(false);
  const [downpaymentAmount, setDownpaymentAmount] = useState("");
  const [payLater, setPayLater] = useState(false);
  const [saving, setSaving] = useState<SaleStatusToPost | null>(null);
  const [saleError, setSaleError] = useState("");
  const [saleMessage, setSaleMessage] = useState("");

  const itemCount = cart.length + customLines.length;

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products
      .filter((product) => product.srp != null
        && (category === "All" || product.category === category)
        && (!term || [product.productName, product.sku, product.barcode].join(" ").toLowerCase().includes(term)))
      .sort((a, b) => Number(isPreorder(a)) - Number(isPreorder(b)));
  }, [category, products, query]);

  const totals = useMemo(() => {
    const productSrp = cart.reduce((sum, line) => sum + (line.product.srp ?? 0) * line.quantity, 0);
    const productTotal = cart.reduce((sum, line) => sum + line.actualPrice * line.quantity, 0);
    const customTotal = customLines.reduce((sum, line) => sum + line.actualPrice * line.quantity, 0);
    const srp = productSrp + customTotal;
    const total = productTotal + customTotal;
    return { srp, total, discount: srp - total };
  }, [cart, customLines]);

  const hasDiscount = cart.some((line) => line.actualPrice < (line.product.srp ?? 0));

  function addProduct(product: ProductVariant) {
    const actualPrice = product.srp;
    if (actualPrice == null) return;
    if (isPreorder(product)) {
      setScanMessage(`${product.productName} added as a pre-order — ${product.availability === "display_only" ? "it's a display item" : "currently 0 in stock"}. You'll need to order it from the supplier.`);
    }
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) return current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { product, quantity: 1, actualPrice }];
    });
  }

  const { videoRef: cameraVideoRef, start: startCamera, stop: stopCamera, status: cameraStatus, errorMessage: cameraError } = useBarcodeCamera({
    onDetect: (code) => lookupScan(code),
  });

  useEffect(() => {
    if (showCameraScanner) {
      startCamera();
      return stopCamera;
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCameraScanner]);

  function lookupScan(code: string) {
    const normalized = code.trim().toLowerCase();
    if (!normalized) return;
    const match = products.find((product) => product.barcode.toLowerCase() === normalized || product.sku.toLowerCase() === normalized || product.supplierSku?.toLowerCase() === normalized);
    if (!match) {
      setScanMessage(`No product found for "${code}".`);
      return;
    }
    if (!isPreorder(match)) setScanMessage(`${match.productName} · ${match.available} available.`);
    addProduct(match);
    setScanCode("");
  }

  function updateLine(id: string, change: Partial<Pick<CartLine, "quantity" | "actualPrice" | "doorSwing">>) {
    setCart((current) => current.map((line) => line.product.id === id ? { ...line, ...change } : line));
  }

  function updateCustomLine(id: string, change: Partial<Pick<CustomCartLine, "quantity" | "actualPrice">>) {
    setCustomLines((current) => current.map((line) => line.id === id ? { ...line, ...change } : line));
  }

  function addCustomItem() {
    const name = customName.trim();
    const price = Number(customPrice);
    if (!name) {
      setCustomError("Item name is required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setCustomError("Enter a valid price per piece.");
      return;
    }
    setCustomLines((current) => [...current, { id: `custom-${Date.now()}`, name, sku: customSku.trim(), quantity: 1, actualPrice: price }]);
    setCustomName("");
    setCustomSku("");
    setCustomPrice("");
    setCustomError("");
    setShowCustomForm(false);
  }

  async function submitSale(status: SaleStatusToPost) {
    if (!itemCount) return;
    if (!customerName.trim()) {
      setSaleError("Customer full name is required.");
      return;
    }
    const missingLocation = cart.find((line) => !line.product.locationId);
    if (missingLocation) {
      setSaleError(`${missingLocation.product.productName} has no storage location on record — it can't be sold until that's fixed.`);
      return;
    }
    const missingSwing = cart.find((line) => needsDoorSwing(line.product) && !line.doorSwing);
    if (missingSwing) {
      setSaleError(`Select left or right swing for ${missingSwing.product.productName} before continuing.`);
      return;
    }
    setSaving(status);
    setSaleError("");
    setSaleMessage("");
    try {
      const payload: CreateSaleInput = {
        status,
        customerName: customerName.trim(),
        customerContactNumber: customerContact.trim() || undefined,
        paymentMethod,
        notes: notes || undefined,
        downpaymentAmount: hasDownpayment ? Math.max(0, Number(downpaymentAmount) || 0) : undefined,
        payLater: status === "completed" && payLater,
        lines: [
          ...cart.map((line) => ({
            variantId: line.product.id,
            locationId: line.product.locationId!,
            quantity: line.quantity,
            sellingUnit: line.product.sellingUnit,
            originalSrp: line.product.srp ?? line.actualPrice,
            actualSellingPrice: line.actualPrice,
            discountReason: line.actualPrice < (line.product.srp ?? 0) ? discountReason : undefined,
            isPreorder: isPreorder(line.product),
            doorSwing: line.doorSwing,
          })),
          ...customLines.map((line) => ({
            customItemName: line.name,
            customSku: line.sku || undefined,
            quantity: line.quantity,
            sellingUnit: "piece" as const,
            originalSrp: line.actualPrice,
            actualSellingPrice: line.actualPrice,
          })),
        ],
      };
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sale could not be posted.");

      const label = status === "completed" ? "Sale" : status === "held" ? "Held sale" : "Quotation";
      const paymentNote = status === "completed" && payLater
        ? " Payment is pending — record it later in Transactions."
        : status === "completed" ? " Stock updated." : "";
      setSaleMessage(`${label} ${invoiceNumber(result.data.saleNumber)} saved.${paymentNote}`);
      setCart([]);
      setCustomLines([]);
      setCustomerName("");
      setCustomerContact("");
      setNotes("");
      setShowNoteField(false);
      setHasDownpayment(false);
      setDownpaymentAmount("");
      setPayLater(false);
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

      <div className="cashier-tabs"><button className={mobileTab === "products" ? "is-active" : ""} onClick={() => setMobileTab("products")}>Products</button><button className={mobileTab === "cart" ? "is-active" : ""} onClick={() => setMobileTab("cart")}>Current Sale <span>{itemCount}</span></button></div>

      <main className="cashier-workspace">
        <section className={`cashier-products ${mobileTab !== "products" ? "cashier-mobile-hidden" : ""}`}>
          {inventoryError && <div className="error-banner">{inventoryError} <button className="button button--secondary button--small" onClick={refetch} type="button">Retry</button></div>}
          <div className="cashier-scan-row">
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
            <button className={`button button--small ${showCameraScanner ? "button--primary" : "button--secondary"}`} onClick={() => setShowCameraScanner((value) => !value)} type="button">
              📷 {showCameraScanner ? "Close camera" : "Scan with camera"}
            </button>
          </div>
          {showCameraScanner && (
            <div className="camera-scan-panel">
              <video ref={cameraVideoRef} playsInline muted aria-label="Barcode camera preview" />
              <div className="camera-scan-panel__message">
                {cameraStatus === "starting" && "Starting camera…"}
                {cameraStatus === "scanning" && "Point the camera at a barcode — items are added automatically."}
                {cameraStatus === "error" && (cameraError || "Camera unavailable.")}
              </div>
              {cameraStatus === "error" && <button className="button button--secondary button--small" onClick={startCamera} type="button">Retry camera</button>}
            </div>
          )}
          {scanMessage && <p className="scan-inline-message">{scanMessage}</p>}
          <label className="search-field"><span>⌕</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Search products by name, SKU or barcode" value={query} /></label>
          <div className="chip-row chip-row--compact">{categories.map((item) => <button className={category === item ? "is-active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>

          <button className="custom-item-launcher" onClick={() => setShowCustomForm((value) => !value)} type="button">
            <span>✎</span> Item not in our system? Add a custom order
          </button>
          {showCustomForm && (
            <div className="custom-item-form">
              <div className="form-grid">
                <label className="field"><span>Item name *</span><input onChange={(event) => setCustomName(event.target.value)} placeholder="What the customer is ordering" value={customName} /></label>
                <label className="field"><span>SKU</span><input onChange={(event) => setCustomSku(event.target.value)} placeholder="Optional — supplier code, etc." value={customSku} /></label>
                <label className="field"><span>Price per piece *</span><input min="0" onChange={(event) => setCustomPrice(event.target.value)} placeholder="0.00" step="0.01" type="number" value={customPrice} /></label>
              </div>
              {customError && <small className="inline-error">{customError}</small>}
              <div className="custom-item-form__actions">
                <button className="button button--secondary button--small" onClick={() => { setShowCustomForm(false); setCustomError(""); }} type="button">Cancel</button>
                <button className="button button--primary button--small" onClick={addCustomItem} type="button">Add to sale</button>
              </div>
            </div>
          )}

          <div className="cashier-section-title"><h2>Products</h2><select aria-label="Sort products"><option>Relevance</option><option>Recently sold</option><option>Favourites</option></select></div>
          <div className="cashier-product-grid">{filteredProducts.map((product) => (
            <button className="cashier-product-card" key={product.id} onClick={() => addProduct(product)}>
              <ProductArtwork alt={product.photoAlt} kind={product.photo} />
              <span><strong>{product.productName}</strong><small>{product.color ?? product.model} · {product.size ?? product.model}</small><small>SKU: {product.sku}</small><b>{formatPeso(product.srp)} <i>/ {product.sellingUnit.replaceAll("_", " ")}</i></b>{isPreorder(product) ? <span className="preorder-badge">Pre-order</span> : <StockBadge compact product={product} />}</span>
            </button>
          ))}</div>
          {!filteredProducts.length && <div className="empty-state"><span>↧</span><h3>No products are ready for sale yet</h3><p>Confirm receiving and add SRPs before using Cashier Mode.</p></div>}
        </section>

        <section className={`cashier-cart ${mobileTab !== "cart" ? "cashier-mobile-hidden" : ""}`}>
          <div className="sale-heading"><div><p className="eyebrow">Current transaction</p><h2>New sale</h2></div></div>
          <div className="customer-fields">
            <label className="field"><span>Customer full name *</span><input aria-label="Customer full name" onChange={(event) => setCustomerName(event.target.value)} placeholder="e.g. Ana Cruz" value={customerName} /></label>
            <label className="field"><span>Contact number</span><input aria-label="Customer contact number" onChange={(event) => setCustomerContact(event.target.value)} placeholder="Optional" type="tel" value={customerContact} /></label>
          </div>
          <div className="cart-table"><div className="cart-table__header"><span>Item</span><span>Qty</span><span>SRP</span><span>Actual price</span><span>Total</span></div>
            {cart.map((line, index) => (
              <div className="cart-line" key={line.product.id}>
                <span className="cart-index">{index + 1}</span><ProductArtwork alt={line.product.photoAlt} kind={line.product.photo} />
                <div className="cart-line__name">
                  <strong>{line.product.productName}</strong>
                  <small>{line.product.color ?? line.product.model} · {line.product.size ?? line.product.model}</small>
                  <small>SKU: {line.product.sku}</small>
                  {(isPreorder(line.product) || line.quantity > line.product.available) && <small className="preorder-note">Pre-order — order from supplier</small>}
                  {needsDoorSwing(line.product) && (
                    <label className="door-swing-field">
                      <span>Swing *</span>
                      <select
                        aria-label={`Door swing for ${line.product.productName}`}
                        onChange={(event) => updateLine(line.product.id, { doorSwing: (event.target.value || undefined) as DoorSwing | undefined })}
                        value={line.doorSwing ?? ""}
                      >
                        <option value="">Select…</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  )}
                </div>
                <label><span className="mobile-only">Quantity</span><input min="1" onChange={(event) => updateLine(line.product.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} type="number" value={line.quantity} /><small>{line.product.sellingUnit.replaceAll("_", " ")}</small></label>
                <span className="cart-line__srp">{formatPeso(line.product.srp)}</span>
                <label><span className="mobile-only">Actual price</span><input aria-label={`Actual selling price for ${line.product.productName}`} min="0" onChange={(event) => updateLine(line.product.id, { actualPrice: Math.max(0, Number(event.target.value)) })} type="number" value={line.actualPrice} />{line.actualPrice < (line.product.srp ?? 0) && <small className="approval-note">{user.role === "owner" || user.role === "manager" ? "Discount auto-approved" : "Needs owner/manager approval"}</small>}</label>
                <strong className="cart-line__total">{formatPeso(line.actualPrice * line.quantity)}</strong>
                <button className="cart-remove" aria-label={`Remove ${line.product.productName}`} onClick={() => setCart((current) => current.filter((item) => item.product.id !== line.product.id))}>×</button>
              </div>
            ))}
            {customLines.map((line, index) => (
              <div className="cart-line" key={line.id}>
                <span className="cart-index">{cart.length + index + 1}</span>
                <div className="product-artwork product-artwork--generic custom-item-swatch" role="img" aria-label="Custom item"><span>✎</span></div>
                <div className="cart-line__name"><strong>{line.name}</strong><small>{line.sku || "No SKU"}</small><small className="preorder-note">Custom item — not in our system</small></div>
                <label><span className="mobile-only">Quantity</span><input min="1" onChange={(event) => updateCustomLine(line.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} type="number" value={line.quantity} /><small>piece(s)</small></label>
                <span className="cart-line__srp">{formatPeso(line.actualPrice)}</span>
                <label><span className="mobile-only">Actual price</span><input aria-label={`Price for ${line.name}`} min="0" onChange={(event) => updateCustomLine(line.id, { actualPrice: Math.max(0, Number(event.target.value)) })} type="number" value={line.actualPrice} /></label>
                <strong className="cart-line__total">{formatPeso(line.actualPrice * line.quantity)}</strong>
                <button className="cart-remove" aria-label={`Remove ${line.name}`} onClick={() => setCustomLines((current) => current.filter((item) => item.id !== line.id))}>×</button>
              </div>
            ))}
          </div>
          {!itemCount && <div className="empty-state"><span>▤</span><h3>Cart is empty</h3><p>Scan a barcode, tap a product, or add a custom item.</p></div>}
          <button className="add-note" onClick={() => setShowNoteField((value) => !value)} type="button">＋ Add transaction note</button>
          {showNoteField && <label className="field"><span>Note</span><textarea onChange={(event) => setNotes(event.target.value)} placeholder="Anything worth recording about this sale…" value={notes} /></label>}
          <div className="cart-footer">
            <div>
              {!payLater && <label className="field"><span>Payment method</span><select onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} value={paymentMethod}>{paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>}
              {hasDiscount && <label className="field"><span>Discount reason</span><select onChange={(event) => setDiscountReason(event.target.value)} value={discountReason}><option>Customer negotiation</option><option>Contractor pricing</option><option>Promotional discount</option><option>Damaged packaging</option></select></label>}
            </div>
            <div className="cart-totals"><div><span>Subtotal at SRP</span><strong>{formatPeso(totals.srp)}</strong></div><div><span>Discount</span><strong>-{formatPeso(totals.discount)}</strong></div><div><span>Total</span><strong>{formatPeso(totals.total)}</strong></div></div>
          </div>
          <div className="downpayment-field">
            <label className="checkbox-field"><input checked={payLater} onChange={(event) => setPayLater(event.target.checked)} type="checkbox" /><span>Releasing the item now, customer will pay later (no payment collected yet)</span></label>
          </div>
          <div className="downpayment-field">
            <label className="checkbox-field"><input checked={hasDownpayment} onChange={(event) => setHasDownpayment(event.target.checked)} type="checkbox" /><span>Customer is reserving this with a downpayment (for Hold Sale)</span></label>
            {hasDownpayment && (
              <label className="field"><span>Downpayment amount</span><input min="0" onChange={(event) => setDownpaymentAmount(event.target.value)} placeholder="0.00" step="0.01" type="number" value={downpaymentAmount} /></label>
            )}
          </div>
          {saleError && <div className="error-banner">{saleError}</div>}
          {saleMessage && <div className="success-banner"><span>✓</span><p>{saleMessage}</p></div>}
          <div className="cashier-actions">
            <button className="button button--secondary" disabled={!itemCount || !customerName.trim() || saving !== null} onClick={() => submitSale("held")} type="button">{saving === "held" ? "Holding…" : "Hold Sale"}</button>
            <button className="button button--secondary" disabled={!itemCount || !customerName.trim() || saving !== null} onClick={() => submitSale("quotation")} type="button">{saving === "quotation" ? "Saving…" : "Save as Quotation"}</button>
            <button className="button button--primary" disabled={!itemCount || !customerName.trim() || saving !== null} onClick={() => submitSale("completed")} type="button">{saving === "completed" ? "Completing…" : "Complete Sale"}</button>
          </div>
        </section>
      </main>

      <button className="mobile-cart-summary" onClick={() => setMobileTab("cart")}><span>{itemCount} item types</span><strong>{formatPeso(totals.total)}</strong><span>View cart ›</span></button>
    </div>
  );
}
