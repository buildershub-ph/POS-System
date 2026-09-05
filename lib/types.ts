export type UserRole =
  | "owner"
  | "manager"
  | "sales_employee"
  | "stock_employee"
  | "cashier";

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export type SellingUnit =
  | "piece"
  | "box"
  | "set"
  | "pair"
  | "square_metre"
  | "linear_metre";

export type ProductVariant = {
  id: string;
  productSlug: string;
  productName: string;
  category: string;
  brand: string;
  model: string;
  sku: string;
  supplierSku?: string;
  supplierId?: string;
  supplierName?: string;
  barcode: string;
  color?: string;
  size?: string;
  attributes: Record<string, string | number>;
  sellingUnit: SellingUnit;
  srp?: number;
  available: number;
  incoming?: number;
  reorderLevel: number;
  location: string;
  receiptStatus?: "draft" | "verified" | "posted";
  sourceInvoice?: string;
  deliveryReference?: string;
  deliveryDate?: string;
  draftTransactionId?: string;
  photo: string;
  photoAlt: string;
  piecesPerBox?: number;
  sqmPerBox?: number;
};

export type Supplier = {
  id: string;
  code: string;
  name: string;
};

export type CatalogueSetup = {
  categories: Array<{ id: string; code: string; name: string }>;
  locations: Array<{ id: string; code: string; name: string }>;
  suppliers: Supplier[];
};

export type InventoryTransactionType =
  | "receiving"
  | "transfer"
  | "sale"
  | "customer_return"
  | "supplier_return"
  | "damaged"
  | "display_stock"
  | "physical_count_adjustment"
  | "reversal";

export type InventoryLineInput = {
  variantId: string;
  locationId: string;
  quantityDelta: number;
};

export type InventoryTransactionInput = {
  type: InventoryTransactionType;
  supplierId?: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  reversesTransactionId?: string;
  lines: InventoryLineInput[];
};
