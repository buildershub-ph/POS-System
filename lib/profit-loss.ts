// Pure profit-and-loss maths for completed sales, kept free of any I/O so it
// can be unit-tested and shared by the report page and its CSV export.
//
// Every sold line becomes one flat row, typed "in_stock" (a catalogue item)
// or "custom" (sold outside the catalogue), so the report and the CSV can be
// filtered by type. A whole-sale discount is split across the sale's lines in
// proportion to their value, so each row's sales are what was really charged
// and any filtered subset still adds up.
//
// Cost: in-stock items cost quantity x landed cost. Custom items have no
// recorded cost, so their cost is whatever they sold for -- they carry no
// profit. An in-stock item with no cost on file is counted at zero cost and
// flagged, so the owner can see the profit for it is overstated.

export type ProfitLossItemType = "in_stock" | "custom";

export const itemTypeLabels: Record<ProfitLossItemType, string> = {
  in_stock: "In-stock",
  custom: "Custom",
};

export type ProfitLossLineInput = {
  variantId: string | null;
  customItemName: string | null;
  productName: string | null;
  sku: string | null;
  quantity: number;
  actualSellingPrice: number;
};

export type ProfitLossSaleInput = {
  id: string;
  saleNumber: number;
  createdAt: string;
  customerName: string | null;
  paymentStatus: "paid" | "pending" | null;
  totalDiscountAmount: number;
  lines: ProfitLossLineInput[];
};

export type ProfitLossLine = {
  saleId: string;
  saleNumber: number;
  createdAt: string;
  customerName: string | null;
  paymentStatus: "paid" | "pending" | null;
  itemKey: string;
  name: string;
  sku: string | null;
  type: ProfitLossItemType;
  missingCost: boolean;
  quantity: number;
  unitPrice: number;
  grossSales: number;
  discount: number;
  sales: number;
  unitCost: number;
  cost: number;
  grossProfit: number;
};

export type ProfitLossSale = {
  id: string;
  saleNumber: number;
  createdAt: string;
  customerName: string | null;
  paymentStatus: "paid" | "pending" | null;
  grossSales: number;
  discount: number;
  sales: number;
  cost: number;
  grossProfit: number;
  marginPercent: number | null;
  hasCustomItems: boolean;
  hasMissingCost: boolean;
};

export type ProfitLossItem = {
  key: string;
  name: string;
  sku: string | null;
  type: ProfitLossItemType;
  missingCost: boolean;
  quantity: number;
  unitCost: number;
  sales: number;
  cost: number;
  grossProfit: number;
  marginPercent: number | null;
};

export type ProfitLossSummary = {
  saleCount: number;
  grossSales: number;
  totalDiscounts: number;
  netSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  marginPercent: number | null;
  inStockSales: number;
  customItemSales: number;
  unpaidNetSales: number;
  missingCostItemCount: number;
};

export type ProfitLossReport = {
  summary: ProfitLossSummary;
  sales: ProfitLossSale[];
  items: ProfitLossItem[];
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function marginPercent(profit: number, revenue: number) {
  return revenue > 0 ? round((profit / revenue) * 100) : null;
}

/** One row per sold line. `costs` maps a catalogue variant id to its per-unit cost. */
export function buildProfitLossLines(sales: ProfitLossSaleInput[], costs: Map<string, number>): ProfitLossLine[] {
  const rows: ProfitLossLine[] = [];
  for (const sale of sales) {
    const lineGross = sale.lines.map((line) => round(line.quantity * line.actualSellingPrice));
    const saleGross = lineGross.reduce((total, value) => total + value, 0);
    // Capped at the line total when the sale is recorded; this only guards
    // against bad historical data.
    const saleDiscount = round(Math.min(Math.max(sale.totalDiscountAmount, 0), saleGross));
    let discountLeft = saleDiscount;

    sale.lines.forEach((line, index) => {
      const grossSales = lineGross[index];
      const isLast = index === sale.lines.length - 1;
      // The last line takes whatever is left so the split adds up exactly.
      const discount = saleGross > 0
        ? (isLast ? round(discountLeft) : round((saleDiscount * grossSales) / saleGross))
        : 0;
      discountLeft -= discount;
      const salesValue = round(grossSales - discount);

      const type: ProfitLossItemType = line.variantId ? "in_stock" : "custom";
      const knownCost = line.variantId ? costs.get(line.variantId) : undefined;
      const missingCost = type === "in_stock" && knownCost === undefined;
      const cost = type === "custom" ? salesValue : round(line.quantity * (knownCost ?? 0));
      const unitCost = type === "custom"
        ? (line.quantity > 0 ? round(salesValue / line.quantity) : 0)
        : knownCost ?? 0;

      rows.push({
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        createdAt: sale.createdAt,
        customerName: sale.customerName,
        paymentStatus: sale.paymentStatus,
        itemKey: line.variantId ?? `custom:${(line.customItemName ?? "custom item").trim().toLowerCase()}`,
        name: (type === "custom" ? line.customItemName : line.productName) ?? "Unnamed item",
        sku: line.sku,
        type,
        missingCost,
        quantity: line.quantity,
        unitPrice: line.actualSellingPrice,
        grossSales,
        discount,
        sales: salesValue,
        unitCost,
        cost,
        grossProfit: round(salesValue - cost),
      });
    });
  }
  return rows;
}

/** Totals, per-sale and per-item breakdowns for any (possibly filtered) set of lines. */
export function summarizeProfitLoss(lines: ProfitLossLine[]): ProfitLossReport {
  const sales = new Map<string, ProfitLossSale>();
  const items = new Map<string, ProfitLossItem>();

  for (const line of lines) {
    const sale = sales.get(line.saleId) ?? {
      id: line.saleId,
      saleNumber: line.saleNumber,
      createdAt: line.createdAt,
      customerName: line.customerName,
      paymentStatus: line.paymentStatus,
      grossSales: 0,
      discount: 0,
      sales: 0,
      cost: 0,
      grossProfit: 0,
      marginPercent: null,
      hasCustomItems: false,
      hasMissingCost: false,
    };
    sale.grossSales += line.grossSales;
    sale.discount += line.discount;
    sale.sales += line.sales;
    sale.cost += line.cost;
    sale.hasCustomItems ||= line.type === "custom";
    sale.hasMissingCost ||= line.missingCost;
    sales.set(line.saleId, sale);

    const item = items.get(line.itemKey) ?? {
      key: line.itemKey,
      name: line.name,
      sku: line.sku,
      type: line.type,
      missingCost: line.missingCost,
      quantity: 0,
      unitCost: line.unitCost,
      sales: 0,
      cost: 0,
      grossProfit: 0,
      marginPercent: null,
    };
    item.quantity += line.quantity;
    item.sales += line.sales;
    item.cost += line.cost;
    items.set(line.itemKey, item);
  }

  const saleRows = [...sales.values()].map((sale) => {
    const grossProfit = sale.sales - sale.cost;
    return {
      ...sale,
      grossSales: round(sale.grossSales),
      discount: round(sale.discount),
      sales: round(sale.sales),
      cost: round(sale.cost),
      grossProfit: round(grossProfit),
      marginPercent: marginPercent(grossProfit, sale.sales),
    };
  });

  const itemRows = [...items.values()]
    .map((item) => {
      const grossProfit = item.sales - item.cost;
      return {
        ...item,
        // A custom item's cost tracks its price, so show the average.
        unitCost: item.type === "custom" && item.quantity > 0 ? round(item.cost / item.quantity) : item.unitCost,
        quantity: round(item.quantity),
        sales: round(item.sales),
        cost: round(item.cost),
        grossProfit: round(grossProfit),
        marginPercent: marginPercent(grossProfit, item.sales),
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit || b.sales - a.sales);

  const sum = (pick: (line: ProfitLossLine) => number) => round(lines.reduce((total, line) => total + pick(line), 0));
  const netSales = sum((line) => line.sales);
  const grossProfit = sum((line) => line.grossProfit);

  return {
    summary: {
      saleCount: saleRows.length,
      grossSales: sum((line) => line.grossSales),
      totalDiscounts: sum((line) => line.discount),
      netSales,
      costOfGoodsSold: sum((line) => line.cost),
      grossProfit,
      marginPercent: marginPercent(grossProfit, netSales),
      inStockSales: sum((line) => (line.type === "in_stock" ? line.sales : 0)),
      customItemSales: sum((line) => (line.type === "custom" ? line.sales : 0)),
      unpaidNetSales: sum((line) => (line.paymentStatus === "pending" ? line.sales : 0)),
      missingCostItemCount: itemRows.filter((item) => item.missingCost).length,
    },
    sales: saleRows,
    items: itemRows,
  };
}
