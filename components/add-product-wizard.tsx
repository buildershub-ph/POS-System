"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { generateInternalBarcode } from "@/lib/code128";
import { useCatalogueSetup } from "@/lib/use-catalogue-setup";
import type { SellingUnit } from "@/lib/types";
import { BarcodeLabel } from "./barcode-label";
import { SupplierSelect } from "./supplier-select";

export function AddProductWizard() {
  const router = useRouter();
  const { setup, loading, error: setupError, addSupplier } = useCatalogueSetup();
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierSku, setSupplierSku] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState(() => generateInternalBarcode());
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [finish, setFinish] = useState("");
  const [sellingUnit, setSellingUnit] = useState<SellingUnit>("piece");
  const [srp, setSrp] = useState("");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [locationId, setLocationId] = useState("");
  const [piecesPerBox, setPiecesPerBox] = useState("");
  const [sqmPerBox, setSqmPerBox] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const categoryCode = useMemo(() => setup.categories.find((item) => item.id === categoryId)?.code ?? "PRD", [categoryId, setup.categories]);

  function suggestSku() {
    const base = supplierSku.replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "").toUpperCase();
    setSku(`${categoryCode}-${base || barcode.slice(-8)}`);
  }

  function choosePhoto(file: File | null) {
    setPhoto(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : "");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo) return setError("Add a clear main product photograph.");
    setSaving(true);
    setError("");
    try {
      const photoData = new FormData();
      photoData.append("file", photo);
      const photoResponse = await fetch("/api/inventory/photos", { method: "POST", body: photoData });
      const photoResult = await photoResponse.json();
      if (!photoResponse.ok) throw new Error(photoResult.error ?? "Photograph could not be uploaded.");

      const response = await fetch("/api/inventory/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId, supplierId, supplierSku, sku, barcode, name, brand, model, description,
          mainPhotoPath: photoResult.data.path, sellingUnit, srp, reorderLevel, locationId,
          piecesPerBox: sellingUnit === "box" ? piecesPerBox : "",
          sqmPerBox: sellingUnit === "box" ? sqmPerBox : "",
          attributes: Object.fromEntries(Object.entries({ Size: size, Color: color, Finish: finish }).filter(([, value]) => value)),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Product could not be added.");
      router.push(`/inventory/${result.data.productSlug}?variant=${result.data.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Product could not be added.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="product-wizard" onSubmit={submit}>
      <div className="wizard-progress" aria-label="Five product setup steps">
        {["Basic information", "Photograph", "Variant", "SKU & barcode", "Pricing & stock"].map((step, index) => <span key={step}><i>{index + 1}</i><b>{step}</b></span>)}
      </div>

      <section className="wizard-section"><div className="wizard-section__number">1</div><div><h2>Basic information</h2><p>Identify the product and its supplier.</p></div><div className="form-grid wizard-section__fields">
        <label className="field"><span>Product name *</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. 60×60cm Polished Tile" /></label>
        <label className="field"><span>Category *</span><select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Select category</option>{setup.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Brand</span><input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Brand or Unbranded" /></label>
        <label className="field"><span>Model</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model name or number" /></label>
        <label className="field field--wide"><span>Supplier *</span><SupplierSelect suppliers={setup.suppliers} value={supplierId} onChange={setSupplierId} onAdd={addSupplier} required /></label>
        <label className="field field--wide"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description customers and staff will understand" /></label>
      </div></section>

      <section className="wizard-section"><div className="wizard-section__number">2</div><div><h2>Product photograph</h2><p>A main photo is required for fast visual confirmation.</p></div><div className="wizard-photo">
        {photoPreview ? <Image alt="New product preview" fill sizes="(max-width: 780px) 100vw, 50vw" src={photoPreview} unoptimized /> : <div><span>＋</span><strong>Add main product photo</strong><small>JPG, PNG or WebP · Maximum 10 MB</small></div>}
        <input required aria-label="Upload main product photograph" accept="image/jpeg,image/png,image/webp" capture="environment" type="file" onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} />
      </div></section>

      <section className="wizard-section"><div className="wizard-section__number">3</div><div><h2>Exact variant</h2><p>Record the details that make this item different.</p></div><div className="form-grid wizard-section__fields">
        <label className="field"><span>Size</span><input value={size} onChange={(event) => setSize(event.target.value)} placeholder="e.g. 60×60cm" /></label>
        <label className="field"><span>Colour</span><input value={color} onChange={(event) => setColor(event.target.value)} placeholder="e.g. Beige marble" /></label>
        <label className="field"><span>Finish</span><input value={finish} onChange={(event) => setFinish(event.target.value)} placeholder="e.g. Polished" /></label>
        <label className="field"><span>Selling unit *</span><select value={sellingUnit} onChange={(event) => setSellingUnit(event.target.value as SellingUnit)}><option value="piece">Piece</option><option value="box">Box</option><option value="set">Set</option><option value="pair">Pair</option><option value="square_metre">Square metre</option><option value="linear_metre">Linear metre</option></select></label>
        {sellingUnit === "box" && <><label className="field"><span>Pieces per box</span><input min="0" step="0.001" type="number" value={piecesPerBox} onChange={(event) => setPiecesPerBox(event.target.value)} /></label><label className="field"><span>Square metres per box</span><input min="0" step="0.0001" type="number" value={sqmPerBox} onChange={(event) => setSqmPerBox(event.target.value)} /></label></>}
      </div></section>

      <section className="wizard-section"><div className="wizard-section__number">4</div><div><h2>SKU and barcode</h2><p>The barcode is generated once and remains attached to this exact product.</p></div><div className="form-grid wizard-section__fields">
        <label className="field"><span>Supplier SKU *</span><input required value={supplierSku} onChange={(event) => setSupplierSku(event.target.value)} placeholder="SKU printed on supplier order form" /></label>
        <label className="field"><span>Our own SKU *</span><div className="field-combo"><input required value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder="Your internal SKU" /><button onClick={suggestSku} type="button">Generate</button></div></label>
        <label className="field field--wide"><span>Internal Code 128 barcode</span><div className="field-combo"><input readOnly value={barcode} /><button onClick={() => setBarcode(generateInternalBarcode())} type="button">New code</button></div></label>
        <div className="field--wide"><BarcodeLabel barcode={barcode} sku={sku || "SKU PENDING"} productName={name || "New product"} downloadable /></div>
      </div></section>

      <section className="wizard-section"><div className="wizard-section__number">5</div><div><h2>Pricing and stock setup</h2><p>Set the SRP and default storage location. Stock remains zero until receiving is confirmed.</p></div><div className="form-grid wizard-section__fields">
        <label className="field"><span>SRP</span><input min="0" step="0.01" type="number" value={srp} onChange={(event) => setSrp(event.target.value)} placeholder="0.00" /></label>
        <label className="field"><span>Reorder level</span><input min="0" step="0.001" type="number" value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} /></label>
        <label className="field field--wide"><span>Default location *</span><select required value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Select location</option>{setup.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div></section>

      {(error || setupError) && <div className="error-banner">{error || setupError}</div>}
      <div className="wizard-actions"><button className="button button--secondary" onClick={() => router.back()} type="button">Cancel</button><button className="button button--primary" disabled={saving || loading} type="submit">{saving ? "Saving product…" : "Save new product"}</button></div>
    </form>
  );
}
