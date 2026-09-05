import type { ProductVariant } from "./types";

type InitialOrderItem = {
  supplierCode: string;
  description: string;
  category: "Tiles" | "Panels" | "Accessories";
  size: string;
  finish?: string;
  design?: string;
  orderedQuantity: number;
  invoice: string;
  deliveryReference: string;
  artwork: "tile" | "panel";
};

const initialOrderItems: InitialOrderItem[] = [
  { supplierCode: "01.3060.BHX3600-10-60", description: "30×60cm Glazed Wall Tile", category: "Tiles", size: "30×60cm", finish: "Glazed wall", orderedQuantity: 200, invoice: "INV/2026/31542", deliveryReference: "DR/WH01/2026/26365", artwork: "tile" },
  { supplierCode: "01.3060.BHX3614-10-60", description: "30×60cm Glazed Wall Tile", category: "Tiles", size: "30×60cm", finish: "Glazed wall", orderedQuantity: 200, invoice: "INV/2026/31542", deliveryReference: "DR/WH01/2026/26365", artwork: "tile" },
  { supplierCode: "01.3060.BHX3616-10-60", description: "30×60cm Glazed Wall Tile", category: "Tiles", size: "30×60cm", finish: "Glazed wall", orderedQuantity: 200, invoice: "INV/2026/31542", deliveryReference: "DR/WH01/2026/26365", artwork: "tile" },
  { supplierCode: "01.3060.GBY36019-C10", description: "30×60cm Polished Tile", category: "Tiles", size: "30×60cm", finish: "Polished", orderedQuantity: 200, invoice: "INV/2026/31542", deliveryReference: "DR/WH01/2026/26365", artwork: "tile" },
  { supplierCode: "01.3060.TMG6821-8-72", description: "30×60cm Glazed Wall Tile", category: "Tiles", size: "30×60cm", finish: "Glazed wall", orderedQuantity: 192, invoice: "INV/2026/31542", deliveryReference: "DR/WH01/2026/26365", artwork: "tile" },
  { supplierCode: "01.3060.JG6828-8-72", description: "30×60cm Glazed Wall Tile", category: "Tiles", size: "30×60cm", finish: "Glazed wall", orderedQuantity: 192, invoice: "INV/2026/31542", deliveryReference: "DR/WH01/2026/26365", artwork: "tile" },
  { supplierCode: "01.4040.MBY4037M-48", description: "40×40cm Rustic Tile", category: "Tiles", size: "40×40cm", finish: "Rustic", orderedQuantity: 288, invoice: "INV/2026/31541", deliveryReference: "DR/WH01/2026/26364", artwork: "tile" },
  { supplierCode: "01.4040.MBY4012M-48", description: "40×40cm Rustic Tile", category: "Tiles", size: "40×40cm", finish: "Rustic", orderedQuantity: 288, invoice: "INV/2026/31541", deliveryReference: "DR/WH01/2026/26364", artwork: "tile" },
  { supplierCode: "01.4040.MBY4022M-48", description: "40×40cm Rustic Tile", category: "Tiles", size: "40×40cm", finish: "Rustic", orderedQuantity: 288, invoice: "INV/2026/31541", deliveryReference: "DR/WH01/2026/26364", artwork: "tile" },
  { supplierCode: "01.4040.MBY4025M-48", description: "40×40cm Rustic Tile", category: "Tiles", size: "40×40cm", finish: "Rustic", orderedQuantity: 288, invoice: "INV/2026/31541", deliveryReference: "DR/WH01/2026/26364", artwork: "tile" },
  { supplierCode: "01.3030.TE3D2011", description: "30×30cm Non-Skid Tile", category: "Tiles", size: "30×30cm", finish: "Non-skid", orderedQuantity: 450, invoice: "INV/2026/31540", deliveryReference: "DR/WH01/2026/26363", artwork: "tile" },
  { supplierCode: "01.3030.TE3D2013", description: "30×30cm Non-Skid Tile", category: "Tiles", size: "30×30cm", finish: "Non-skid", orderedQuantity: 450, invoice: "INV/2026/31540", deliveryReference: "DR/WH01/2026/26363", artwork: "tile" },
  { supplierCode: "01.3030.TEN3306-N15", description: "30×30cm Tile", category: "Tiles", size: "30×30cm", finish: "Finish pending", orderedQuantity: 450, invoice: "INV/2026/31540", deliveryReference: "DR/WH01/2026/26363", artwork: "tile" },
  { supplierCode: "01.3030.TECH3053", description: "30×30cm Rustic Tile", category: "Tiles", size: "30×30cm", finish: "Rustic", orderedQuantity: 510, invoice: "INV/2026/31540", deliveryReference: "DR/WH01/2026/26363", artwork: "tile" },
  { supplierCode: "01.6060.FRG0001", description: "60×60cm Super Gloss Granite Tile", category: "Tiles", size: "60×60cm", finish: "Super gloss granite", orderedQuantity: 176, invoice: "INV/2026/31539", deliveryReference: "DR/WH01/2026/26362", artwork: "tile" },
  { supplierCode: "01.6060.BMD65037", description: "60×60cm Polished Tile", category: "Tiles", size: "60×60cm", finish: "Polished", orderedQuantity: 176, invoice: "INV/2026/31539", deliveryReference: "DR/WH01/2026/26362", artwork: "tile" },
  { supplierCode: "01.6060.GBY66000-44", description: "60×60cm Polished Tile", category: "Tiles", size: "60×60cm", finish: "Polished", orderedQuantity: 176, invoice: "INV/2026/31538", deliveryReference: "DR/WH01/2026/26361", artwork: "tile" },
  { supplierCode: "01.6060.GBY66015-44", description: "60×60cm Polished Tile", category: "Tiles", size: "60×60cm", finish: "Polished", orderedQuantity: 176, invoice: "INV/2026/31538", deliveryReference: "DR/WH01/2026/26361", artwork: "tile" },
  { supplierCode: "01.6060.MSM69002-40", description: "60×60cm Rustic Tile", category: "Tiles", size: "60×60cm", finish: "Rustic (3–5%)", orderedQuantity: 160, invoice: "INV/2026/31538", deliveryReference: "DR/WH01/2026/26361", artwork: "tile" },
  { supplierCode: "01.6060.MSM69008-40", description: "60×60cm Rustic Tile", category: "Tiles", size: "60×60cm", finish: "Rustic (3–5%)", orderedQuantity: 160, invoice: "INV/2026/31538", deliveryReference: "DR/WH01/2026/26361", artwork: "tile" },
  { supplierCode: "01.6060.MSM69010-40", description: "60×60cm Rustic Tile", category: "Tiles", size: "60×60cm", finish: "Rustic (3–5%)", orderedQuantity: 160, invoice: "INV/2026/31538", deliveryReference: "DR/WH01/2026/26361", artwork: "tile" },
  { supplierCode: "01.6060.MSM69013-40", description: "60×60cm Rustic Tile", category: "Tiles", size: "60×60cm", finish: "Rustic (3–5%)", orderedQuantity: 160, invoice: "INV/2026/31538", deliveryReference: "DR/WH01/2026/26361", artwork: "tile" },
  { supplierCode: "16.ZH.250FB8/02/29", description: "250×2900mm Laminated PVC Flat Panel", category: "Panels", size: "250×2900mm", finish: "Flat laminated PVC", design: "Design 02", orderedQuantity: 50, invoice: "INV/2026/31537", deliveryReference: "DR/WH01/2026/26360", artwork: "panel" },
  { supplierCode: "16.ZH.250TV8/02/29", description: "250×2900mm Laminated PVC Two V-Cut Panel", category: "Panels", size: "250×2900mm", finish: "Two V-cut laminated PVC", design: "Design 02", orderedQuantity: 50, invoice: "INV/2026/31537", deliveryReference: "DR/WH01/2026/26360", artwork: "panel" },
  { supplierCode: "16.ZH.250TV8/03/29", description: "250×2900mm Laminated PVC Two V-Cut Panel", category: "Panels", size: "250×2900mm", finish: "Two V-cut laminated PVC", design: "Design 03", orderedQuantity: 50, invoice: "INV/2026/31537", deliveryReference: "DR/WH01/2026/26360", artwork: "panel" },
  { supplierCode: "16.ZH.250FB8/04/29", description: "250×2900mm Laminated PVC Flat Panel", category: "Panels", size: "250×2900mm", finish: "Flat laminated PVC", design: "Design 04", orderedQuantity: 50, invoice: "INV/2026/31537", deliveryReference: "DR/WH01/2026/26360", artwork: "panel" },
  { supplierCode: "16.ZH.250FB8/05/29", description: "250×2900mm Laminated PVC Flat Panel", category: "Panels", size: "250×2900mm", finish: "Flat laminated PVC", design: "Design 05", orderedQuantity: 50, invoice: "INV/2026/31537", deliveryReference: "DR/WH01/2026/26360", artwork: "panel" },
  { supplierCode: "16.ZH.UBAR/02/29", description: "PVC U-Bar 2900mm", category: "Accessories", size: "2900mm", design: "Design 02", orderedQuantity: 40, invoice: "INV/2026/31535", deliveryReference: "DR/WH01/2026/26359", artwork: "panel" },
  { supplierCode: "16.ZH.UBAR/03/29", description: "PVC U-Bar 2900mm", category: "Accessories", size: "2900mm", design: "Design 03", orderedQuantity: 40, invoice: "INV/2026/31535", deliveryReference: "DR/WH01/2026/26359", artwork: "panel" },
  { supplierCode: "16.ZH.UBAR/04/29", description: "PVC U-Bar 2900mm", category: "Accessories", size: "2900mm", design: "Design 04", orderedQuantity: 40, invoice: "INV/2026/31535", deliveryReference: "DR/WH01/2026/26359", artwork: "panel" },
  { supplierCode: "16.ZH.UBAR/05/29", description: "PVC U-Bar 2900mm", category: "Accessories", size: "2900mm", design: "Design 05", orderedQuantity: 40, invoice: "INV/2026/31535", deliveryReference: "DR/WH01/2026/26359", artwork: "panel" },
];

function skuFor(item: InitialOrderItem) {
  const withoutPrefix = item.supplierCode.replace(/^\d+\.\d+\./, "").replace(/^\d+\.[A-Z]+\./, "").replaceAll("/", "-");
  const prefix = item.category === "Tiles" ? "TIL" : item.category === "Panels" ? "PNL" : "PAC";
  return `${prefix}-${withoutPrefix}`;
}

function slugFor(sku: string) {
  return sku.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

export const initialOrderProducts: ProductVariant[] = initialOrderItems.map((item, index) => {
  const sku = skuFor(item);
  return {
    id: `initial-variant-${String(index + 1).padStart(3, "0")}`,
    productSlug: slugFor(sku),
    productName: item.description,
    category: item.category,
    brand: "Brand pending",
    model: item.supplierCode,
    sku,
    barcode: sku,
    color: item.design,
    size: item.size,
    attributes: { Finish: item.finish ?? "Not specified", "Supplier item code": item.supplierCode, "Source invoice": item.invoice, "Ordered units": item.orderedQuantity, "Receipt status": "Draft — not yet available" },
    sellingUnit: "piece",
    available: 0,
    incoming: item.orderedQuantity,
    reorderLevel: 0,
    location: "Destination location pending",
    receiptStatus: "draft",
    sourceInvoice: item.invoice,
    deliveryReference: item.deliveryReference,
    deliveryDate: "2026-08-04",
    photo: item.artwork,
    photoAlt: `${item.description} placeholder photograph`,
  };
});

export const initialOrderSummary = {
  invoiceCount: 7,
  productLines: initialOrderProducts.length,
  incomingUnits: initialOrderProducts.reduce((sum, product) => sum + (product.incoming ?? 0), 0),
};
