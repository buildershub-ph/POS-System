"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInventory } from "@/lib/use-inventory";

type DetectorResult = { rawValue: string };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => { detect(source: HTMLVideoElement): Promise<DetectorResult[]> };

export function BarcodeScanner() {
  const { products } = useInventory();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const productsRef = useRef(products);
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState("Point the camera at a barcode");

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const locateProduct = useCallback((value: string) => {
    const normalized = value.trim().toLowerCase();
    const match = productsRef.current.find((product) => product.barcode.toLowerCase() === normalized || product.sku.toLowerCase() === normalized || product.supplierSku?.toLowerCase() === normalized);
    if (match) router.push(`/inventory/${match.productSlug}?variant=${match.id}`);
    else setMessage(`No product found for “${value}”. Check the code or add a new product.`);
  }, [router]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
        setMessage("Camera scanning is unavailable. Enter the SKU or barcode below.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!Detector) return;
        const detector = new Detector({ formats: ["code_128", "ean_13", "ean_8", "upc_a", "upc_e"] });
        const scan = async () => {
          if (cancelled || !videoRef.current) return;
          const results = await detector.detect(videoRef.current);
          if (results[0]?.rawValue) {
            locateProduct(results[0].rawValue);
            return;
          }
          timer = setTimeout(scan, 350);
        };
        timer = setTimeout(scan, 500);
      } catch {
        setMessage("Camera permission was not granted. Use manual barcode or SKU entry.");
      }
    }

    startCamera();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [locateProduct]);

  return (
    <div className="scanner-layout">
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted aria-label="Barcode camera preview" />
        <div className="scanner-shade"><span className="scanner-corner scanner-corner--tl" /><span className="scanner-corner scanner-corner--tr" /><span className="scanner-corner scanner-corner--bl" /><span className="scanner-corner scanner-corner--br" /><i /></div>
        <div className="scanner-message"><span>⌗</span>{message}</div>
      </div>
      <div className="scanner-manual"><h2>Enter code manually</h2><p>Use our SKU, supplier SKU, or the product barcode.</p><form onSubmit={(event) => { event.preventDefault(); locateProduct(manualCode); }}><input autoCapitalize="characters" onChange={(event) => setManualCode(event.target.value)} placeholder="Our SKU, supplier SKU or barcode" value={manualCode} /><button className="button button--primary" type="submit">Find Product</button></form><label className="file-scan"><span>Use a barcode photograph</span><input accept="image/*" capture="environment" type="file" /></label></div>
    </div>
  );
}
