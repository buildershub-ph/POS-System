"use client";

import { useEffect, useRef } from "react";
import { code128Modules } from "@/lib/code128";

type BarcodeLabelProps = {
  barcode: string;
  sku: string;
  productName: string;
  downloadable?: boolean;
};

function drawLabel(canvas: HTMLCanvasElement, barcode: string, sku: string, productName: string) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = 760;
  const height = 280;
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111111";
  context.font = "700 24px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(productName.slice(0, 52), width / 2, 34);

  const bars = code128Modules(barcode);
  const totalModules = bars.reduce((total, bar) => total + bar.width, 0) + 20;
  const moduleWidth = Math.max(1, Math.floor((width - 56) / totalModules));
  let position = Math.floor((width - totalModules * moduleWidth) / 2) + 10 * moduleWidth;
  for (const bar of bars) {
    const barWidth = bar.width * moduleWidth;
    if (bar.black) context.fillRect(position, 52, barWidth, 142);
    position += barWidth;
  }
  context.font = "22px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText(barcode, width / 2, 226);
  context.font = "700 20px Arial, sans-serif";
  context.fillText(`SKU: ${sku}`, width / 2, 258);
}

export function BarcodeLabel({ barcode, sku, productName, downloadable = false }: BarcodeLabelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && barcode) drawLabel(canvasRef.current, barcode, sku, productName);
  }, [barcode, productName, sku]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${sku || barcode}-barcode.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <div className="barcode-label">
      <canvas aria-label={`Code 128 barcode ${barcode}`} ref={canvasRef} role="img" />
      {downloadable && <button className="button button--secondary button--small" onClick={download} type="button">↓ Download barcode label</button>}
    </div>
  );
}
