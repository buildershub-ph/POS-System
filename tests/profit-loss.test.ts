import assert from "node:assert/strict";
import test from "node:test";
import { buildProfitLossReport } from "../lib/profit-loss.ts";

const tile = "10000000-0000-0000-0000-000000000001";
const door = "10000000-0000-0000-0000-000000000002";
const costs = new Map([[tile, 60], [door, 9450]]);

test("nets whole-sale discounts and subtracts landed cost", () => {
  const report = buildProfitLossReport(
    [{
      id: "a", saleNumber: 1, createdAt: "2026-09-01T10:00:00Z", customerName: "Ana", paymentStatus: "paid", totalDiscountAmount: 100,
      lines: [
        { variantId: tile, customItemName: null, productName: "Tile", sku: "T-1", quantity: 10, actualSellingPrice: 100 },
        { variantId: door, customItemName: null, productName: "Door", sku: "D-1", quantity: 1, actualSellingPrice: 12000 },
      ],
    }],
    costs,
  );
  assert.equal(report.summary.grossSales, 13000);
  assert.equal(report.summary.totalDiscounts, 100);
  assert.equal(report.summary.netSales, 12900);
  assert.equal(report.summary.costOfGoodsSold, 10050);
  assert.equal(report.summary.grossProfit, 2850);
  assert.equal(report.items[0].key, door);
});

test("custom items count at zero cost and missing costs are flagged", () => {
  const report = buildProfitLossReport(
    [{
      id: "b", saleNumber: 2, createdAt: "2026-09-02T10:00:00Z", customerName: null, paymentStatus: "pending", totalDiscountAmount: 0,
      lines: [
        { variantId: null, customItemName: "Special Order Sink", productName: null, sku: null, quantity: 2, actualSellingPrice: 500 },
        { variantId: "unknown", customItemName: null, productName: "Grout", sku: "G-1", quantity: 1, actualSellingPrice: 200 },
      ],
    }],
    costs,
  );
  assert.equal(report.summary.costOfGoodsSold, 0);
  assert.equal(report.summary.grossProfit, 1200);
  assert.equal(report.summary.customItemSales, 1000);
  assert.equal(report.summary.unpaidNetSales, 1200);
  assert.equal(report.summary.missingCostItemCount, 1);
  assert.equal(report.sales[0].hasCustomItems, true);
  assert.equal(report.sales[0].hasMissingCost, true);
  assert.equal(report.items.find((item) => item.isCustom)?.cost, 0);
});
