// Pure profit-and-loss maths for completed sales, kept free of any I/O so it
// can be unit-tested and shared by the JSON report and its CSV export.
//
// Revenue is what the customer was actually charged: every line at its
// actual selling price, less any whole-sale discount. Cost of goods sold is
// quantity x landed cost for catalogue items. Custom items (sold outside the
// catalogue) have no recorded cost, so they count at zero cost. A catalogue
// item with no cost on file is also counted at zero but flagged, so the
// owner can see the profit for it is overstated.

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

export type ProfitLossSale = {
  id: string;
  saleNumber: number;
  createdAt: string;
  customerName: string | null;
  paymentStatus: "paid" | "pending" | null;
  grossSales: number;
  totalDiscount: number;
  netSales: number;
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
  isCustom: boolean;
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
  catalogueSales: number;
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

function margin(profit: number, revenue: number) {
  return revenue > 0 ? round((profit / revenue) * 100) : null;
}

/** `costs` maps a catalogue variant id to its per-unit cost. */
export function buildProfitLossReport(
  sales: ProfitLossSaleInput[],
  costs: Map<string, number>,
): ProfitLossReport {
  const items = new Map<string, ProfitLossItem>();
  const saleRows: ProfitLossSale[] = [];
  let catalogueSales = 0;
  let customItemSales = 0;

  for (const sale of sales) {
    let grossSales = 0;
    let cost = 0;
    let hasCustomItems = false;
    let hasMissingCost = false;

    for (const line of sale.lines) {
      const lineSales = line.quantity * line.actualSellingPrice;
      const isCustom = !line.variantId;
      const knownCost = line.variantId ? costs.get(line.variantId) : undefined;
      const missingCost = !isCustom && knownCost === undefined;
      const unitCost = knownCost ?? 0;
      const lineCost = line.quantity * unitCost;

      grossSales += lineSales;
      cost += lineCost;
      if (isCustom) {
        hasCustomItems = true;
        customItemSales += lineSales;
      } else {
        catalogueSales += lineSales;
      }
      if (missingCost) hasMissingCost = true;

      const key = line.variantId ?? `custom:${(line.customItemName ?? "custom item").trim().toLowerCase()}`;
      const item = items.get(key) ?? {
        key,
        name: (isCustom ? line.customItemName : line.productName) ?? "Unnamed item",
        sku: line.sku,
        isCustom,
        missingCost,
        quantity: 0,
        unitCost,
        sales: 0,
        cost: 0,
        grossProfit: 0,
        marginPercent: null,
      };
      item.quantity += line.quantity;
      item.sales += lineSales;
      item.cost += lineCost;
      items.set(key, item);
    }

    // The whole-sale discount is capped at the line total when the sale is
    // recorded, so this only guards against bad historical data.
    const totalDiscount = Math.min(sale.totalDiscountAmount, grossSales);
    const netSales = grossSales - totalDiscount;
    const grossProfit = netSales - cost;
    saleRows.push({
      id: sale.id,
      saleNumber: sale.saleNumber,
      createdAt: sale.createdAt,
      customerName: sale.customerName,
      paymentStatus: sale.paymentStatus,
      grossSales: round(grossSales),
      totalDiscount: round(totalDiscount),
      netSales: round(netSales),
      cost: round(cost),
      grossProfit: round(grossProfit),
      marginPercent: margin(grossProfit, netSales),
      hasCustomItems,
      hasMissingCost,
    });
  }

  const itemRows = [...items.values()]
    .map((item) => {
      const grossProfit = item.sales - item.cost;
      return {
        ...item,
        quantity: round(item.quantity),
        sales: round(item.sales),
        cost: round(item.cost),
        grossProfit: round(grossProfit),
        marginPercent: margin(grossProfit, item.sales),
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit);

  const sum = (pick: (sale: ProfitLossSale) => number) => round(saleRows.reduce((total, sale) => total + pick(sale), 0));
  const netSales = sum((sale) => sale.netSales);
  const grossProfit = sum((sale) => sale.grossProfit);

  return {
    summary: {
      saleCount: saleRows.length,
      grossSales: sum((sale) => sale.grossSales),
      totalDiscounts: sum((sale) => sale.totalDiscount),
      netSales,
      costOfGoodsSold: sum((sale) => sale.cost),
      grossProfit,
      marginPercent: margin(grossProfit, netSales),
      catalogueSales: round(catalogueSales),
      customItemSales: round(customItemSales),
      unpaidNetSales: sum((sale) => (sale.paymentStatus === "pending" ? sale.netSales : 0)),
      missingCostItemCount: itemRows.filter((item) => item.missingCost).length,
    },
    sales: saleRows,
    items: itemRows,
  };
}
