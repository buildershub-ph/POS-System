"use client";

import { useMemo, useState } from "react";
import { useInventory } from "@/lib/use-inventory";
import { useCatalogueSetup } from "@/lib/use-catalogue-setup";
import { ProductArtwork } from "./product-artwork";
import { SupplierSelect } from "./supplier-select";

export function ReceiveStock() {
  const { products } = useInventory();
  const { setup, addSupplier } = useCatalogueSetup();
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState<number | null>(null);
  const [damaged, setDamaged] = useState(0);
  const [status, setStatus] = useState<"draft" | "confirmed">("draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("20000000-0000-0000-0000-000000000002");
  const selected = useMemo(() => products.find((product) => product.id === selectedId) ?? products[0], [products, selectedId]);
  const [supplierId, setSupplierId] = useState("");
  const [itemPhoto, setItemPhoto] = useState<File | null>(null);
  const [itemPhotoPreview, setItemPhotoPreview] = useState("");

  if (!selected) return <div className="empty-state"><h3>No inventory products found</h3></div>;
  const receivedQuantity = quantity ?? selected.incoming ?? 1;
  const effectiveSupplierId = supplierId || selected.supplierId || "";
  const hasStoredItemPhoto = selected.photo.startsWith("/api/inventory/photos/");

  function chooseItemPhoto(file: File | null) {
    setItemPhoto(file);
    if (itemPhotoPreview) URL.revokeObjectURL(itemPhotoPreview);
    setItemPhotoPreview(file ? URL.createObjectURL(file) : "");
  }

  async function confirmReceiving() {
    if (!hasStoredItemPhoto && !itemPhoto) {
      setError("Add a clear item photo before confirming this receiving.");
      return;
    }
    setSaving(true);
    setError("");
    const goodQuantity = Math.max(0, receivedQuantity - damaged);
    try {
      if (itemPhoto) {
        const photoData = new FormData();
        photoData.append("file", itemPhoto);
        const photoResponse = await fetch("/api/inventory/photos", { method: "POST", body: photoData });
        const photoResult = await photoResponse.json();
        if (!photoResponse.ok) throw new Error(photoResult.error ?? "Item photo could not be uploaded.");
        const savePhotoResponse = await fetch(`/api/inventory/products/${selected.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoPath: photoResult.data.path }),
        });
        const savePhotoResult = await savePhotoResponse.json();
        if (!savePhotoResponse.ok) throw new Error(savePhotoResult.error ?? "Item photo could not be saved.");
      }

      const response = await fetch("/api/inventory/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "receiving",
          destinationLocationId,
          sourceInvoice: selected.sourceInvoice,
          deliveryReference: selected.deliveryReference,
          supersedesDraftId: selected.draftTransactionId,
          supplierId: effectiveSupplierId,
          lines: [{ variantId: selected.id, locationId: destinationLocationId, quantityDelta: goodQuantity }],
          reason: "Supplier delivery confirmed",
          notes: damaged > 0 ? `${damaged} damaged unit(s) excluded from available stock.` : "Physical delivery verified.",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Receiving could not be posted.");
      setStatus("confirmed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Receiving could not be posted.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="workflow-layout">
      <section className="workflow-card">
        <div className="imported-draft-banner"><span>↧</span><div><strong>31 receipt lines imported as Draft</strong><p>Ordered quantities are loaded, but available inventory remains unchanged until you verify the physical delivery.</p></div></div>
        <div className="workflow-steps"><span className="is-active">1</span><i /><span>2</span><i /><span>3</span></div>
        <div className="workflow-step-labels"><span>Delivery</span><span>Items</span><span>Confirm</span></div>

        <div className="form-grid">
          <label className="field field--wide"><span>Scan barcode or search product</span><div className="field-combo"><input defaultValue={selected.sku} aria-label="Barcode or SKU" /><a href="/scan">⌗</a></div></label>
          <label className="field"><span>Supplier *</span><SupplierSelect suppliers={setup.suppliers} value={effectiveSupplierId} onChange={setSupplierId} onAdd={addSupplier} required /></label>
          <label className="field"><span>Delivery reference *</span><input key={selected.deliveryReference} defaultValue={selected.deliveryReference} /></label>
          <label className="field"><span>Destination location *</span><select value={destinationLocationId} onChange={(event) => setDestinationLocationId(event.target.value)}><option value="20000000-0000-0000-0000-000000000002">Warehouse</option><option value="20000000-0000-0000-0000-000000000001">Main Showroom</option><option value="20000000-0000-0000-0000-000000000003">Display Area</option></select></label>
          <label className="field"><span>Delivery date</span><input type="date" defaultValue={selected.deliveryDate} /></label>
        </div>

        <div className="selected-product-row">
          <ProductArtwork alt={selected.photoAlt} kind={itemPhotoPreview || selected.photo} />
          <div><strong>{selected.productName}</strong><span>{selected.color} · {selected.size}</span><small>SKU: {selected.sku}</small></div>
          <select aria-label="Choose received product" value={selected.id} onChange={(event) => { const nextId = event.target.value; const next = products.find((product) => product.id === nextId); if (itemPhotoPreview) URL.revokeObjectURL(itemPhotoPreview); setItemPhoto(null); setItemPhotoPreview(""); setSelectedId(nextId); setSupplierId(next?.supplierId ?? ""); setQuantity(next?.incoming ?? 1); setDamaged(0); setStatus("draft"); }}>{products.map((product) => <option key={product.id} value={product.id}>{product.sku}</option>)}</select>
        </div>

        <div className={`item-photo-upload ${hasStoredItemPhoto || itemPhoto ? "is-ready" : "is-required"}`}>
          <ProductArtwork alt={`${selected.productName} item photo`} kind={itemPhotoPreview || selected.photo} />
          <div><strong>Item photo *</strong><small>{hasStoredItemPhoto ? "A product photo is already saved. Choose a file only to replace it." : "Required for this item before stock can be confirmed."}</small></div>
          <label className="button button--secondary button--small">{hasStoredItemPhoto ? "Replace photo" : "Upload item photo"}<input aria-label="Upload item photograph" accept="image/jpeg,image/png,image/webp" capture="environment" type="file" onChange={(event) => chooseItemPhoto(event.target.files?.[0] ?? null)} /></label>
        </div>

        <div className="quantity-grid">
          <label className="field"><span>Received quantity *</span><input min="1" type="number" value={receivedQuantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <label className="field"><span>Damaged quantity</span><input min="0" type="number" value={damaged} onChange={(event) => setDamaged(Number(event.target.value))} /></label>
          <div className="quantity-summary"><span>Good stock</span><strong>{Math.max(0, receivedQuantity - damaged)}</strong><small>{selected.sellingUnit.replaceAll("_", " ")}(s)</small></div>
        </div>

        <label className="field"><span>Notes</span><textarea placeholder="Condition, missing items, packaging notes…" /></label>
        <div className="photo-upload"><span>＋</span><div><strong>Add delivery photo</strong><small>Optional proof of delivery or damaged packaging. This is separate from the required item photo above.</small></div><input aria-label="Upload delivery photograph" accept="image/*" capture="environment" type="file" /></div>

        <div className="workflow-actions"><button className="button button--secondary" onClick={() => setStatus("draft")} type="button">Save Draft</button><button className="button button--primary" disabled={saving || status === "confirmed" || !effectiveSupplierId || receivedQuantity - damaged <= 0} onClick={confirmReceiving} type="button">{saving ? "Uploading and posting…" : status === "confirmed" ? "Receiving Confirmed" : "Confirm Receiving"}</button></div>
        {error && <div className="error-banner">{error}</div>}
        {status === "confirmed" && <div className="success-banner"><span>✓</span><div><strong>Receiving posted successfully</strong><p>Available inventory has been updated through an immutable transaction.</p></div></div>}
      </section>

      <aside className="workflow-summary"><span className="summary-kicker">Receiving summary</span><h3>{selected.productName}</h3><dl><div><dt>Ordered quantity</dt><dd>{selected.incoming}</dd></div><div><dt>Current available</dt><dd>{selected.available}</dd></div><div><dt>Good received</dt><dd>+{Math.max(0, receivedQuantity - damaged)}</dd></div><div><dt>Damaged</dt><dd>{damaged}</dd></div><div className="summary-total"><dt>Expected after posting</dt><dd>{selected.available + Math.max(0, receivedQuantity - damaged)}</dd></div></dl><p>Drafts do not change inventory. Stock changes only after confirmation succeeds.</p></aside>
    </div>
  );
}
