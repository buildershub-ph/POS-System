export type UserRole =
  | "owner"
  | "manager"
  | "sales_employee"
  | "stock_employee"
  | "cashier";

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock" | "display_only";

// "stocked" items are physically on hand. "display_only" items are shown in the
// showroom or catalogue for customers to see, but are not kept in stock — staff
// tell the customer it is available by order only.
export type VariantAvailability = "stocked" | "display_only";

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
  locationId?: string;
  locationCompany?: string;
  availability: VariantAvailability;
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
  locations: Array<{ id: string; code: string; name: string; company?: string }>;
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

// Owner-only pricing data. This is fetched separately from the main catalogue
// so a private cost or margin can never accidentally end up in a response that
// a non-owner role can read.
export type VariantMargin = {
  variantId: string;
  sku: string;
  srp: number;
  unitCost: number;
  landedCost: number;
  minimumSellingPrice: number;
  grossMarginAmount: number;
};

export type TeamMember = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  active: boolean;
};

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

export type SaleStatus = "held" | "quotation" | "completed" | "cancelled";
export type PaymentMethod = "cash" | "gcash" | "maya" | "bank_transfer" | "card" | "split";

// A sale line is either a catalog product (variantId + locationId, deducts
// stock) or a custom/one-off item not in the system at all (customItemName,
// no stock impact — just a record of what was sold).
export type SaleLineInput = {
  variantId?: string;
  locationId?: string;
  customItemName?: string;
  customSku?: string;
  quantity: number;
  sellingUnit: SellingUnit;
  originalSrp: number;
  actualSellingPrice: number;
  discountReason?: string;
};

export type CreateSaleInput = {
  status: "held" | "quotation" | "completed";
  customerName: string;
  customerContactNumber?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  lines: SaleLineInput[];
};

export type SaleLineRecord = {
  variantId?: string;
  customItemName?: string;
  customSku?: string;
  quantity: number;
  sellingUnit: SellingUnit;
  originalSrp: number;
  actualSellingPrice: number;
  discountReason?: string;
};

export type SaleRecord = {
  id: string;
  saleNumber: number;
  status: SaleStatus;
  customerName?: string;
  customerContactNumber?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  inventoryTransactionId?: string;
  createdAt: string;
  completedAt?: string;
  totalAmount: number;
  totalSrp: number;
  lineCount: number;
  lines: SaleLineRecord[];
};
