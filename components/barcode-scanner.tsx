"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useBarcodeCamera } from "@/lib/use-barcode-camera";
import { useInventory } from "@/lib/use-inventory";

export function BarcodeScanner() {
  const { products } = useInventory();
  const router = useRouter();
  const productsRef = useRef(products);
  const [manualCode, setManualCode] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const locateProduct = useCallback((value: string) => {
    const normalized = value.trim().toLowerCase();
    const match = productsRef.current.find((product) => product.barcode.toLowerCase() === normalized || product.sku.toLowerCase() === normalized || product.supplierSku?.toLowerCase() === normalized);
    if (match) router.push(`/inventory/${match.productSlug}?variant=${match.id}`);
    else setScanMessage(`No product found for "${value}". Check the code or add a new product.`);
  }, [router]);

  const { videoRef, start, stop, status: cameraStatus, errorMessage: cameraError } = useBarcodeCamera({ onDetect: locateProduct });

  useEffect(() => {
    start();
    return stop;
    // Only ever start once on mount -- start/stop are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusMessage = cameraStatus === "starting" ? "Starting camera…"
    : cameraStatus === "scanning" ? "Point the camera at a barcode"
    : cameraStatus === "error" ? (cameraError || "Camera unavailable. Use manual entry below.")
    : "";
  const displayMessage = scanMessage || statusMessage;

  async function scanPhoto(file: File | null) {
    if (!file) return;
    setPhotoBusy(true);
    setScanMessage("");
    const objectUrl = URL.createObjectURL(file);
    try {
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(objectUrl);
      locateProduct(result.getText());
    } catch {
      setScanMessage("No barcode could be read from that photo. Try a clearer, closer photo, or enter the code manually.");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setPhotoBusy(false);
    }
  }

  return (
    <div className="scanner-layout">
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted aria-label="Barcode camera preview" />
        <div className="scanner-shade"><span className="scanner-corner scanner-corner--tl" /><span className="scanner-corner scanner-corner--tr" /><span className="scanner-corner scanner-corner--bl" /><span className="scanner-corner scanner-corner--br" /><i /></div>
        <div className="scanner-message"><span>⌗</span>{displayMessage}</div>
        {cameraStatus === "error" && <button className="button button--primary button--small scanner-retry" onClick={start} type="button">Retry camera</button>}
      </div>
      <div className="scanner-manual">
        <h2>Enter code manually</h2>
        <p>Use our SKU, supplier SKU, or the product barcode.</p>
        <form onSubmit={(event) => { event.preventDefault(); locateProduct(manualCode); }}>
          <input autoCapitalize="characters" onChange={(event) => setManualCode(event.target.value)} placeholder="Our SKU, supplier SKU or barcode" value={manualCode} />
          <button className="button button--primary" type="submit">Find Product</button>
        </form>
        <label className="file-scan">
          <span>{photoBusy ? "Reading photo…" : "Use a barcode photograph"}</span>
          <input accept="image/*" capture="environment" disabled={photoBusy} onChange={(event) => scanPhoto(event.target.files?.[0] ?? null)} type="file" />
        </label>
      </div>
    </div>
  );
}
