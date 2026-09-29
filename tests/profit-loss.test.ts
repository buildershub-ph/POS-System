import assert from "node:assert/strict";
import test from "node:test";
import { buildProfitLossLines, summarizeProfitLoss } from "../lib/profit-loss.ts";

const tile = "10000000-0000-0000-0000-000000000001";
const door = "10000000-0000-0000-0000-000000000002";
const costs = new Map([[tile, 60], [door, 9450]]);

const sales = [
  {
    id: "a", saleNumber: 1, createdAt: "2026-09-01T10:00:00Z", customerName: "Ana", paymentStatus: "paid" as const, totalDiscountAmount: 130,
    lines: [
      { variantId: tile, customItemName: null, productName: "Tile", sku: "T-1", quantity: 10, actualSellingPrice: 100 },
      { variantId: door, customItemName: null, productName: "Door", sku: "D-1", quantity: 1, actualSellingPrice: 12000 },
    ],
  },
  {
    id: "b", saleNumber: 2, createdAt: "2026-09-02T10:00:00Z", customerName: null, paymentStatus: "pending" as const, totalDiscountAmount: 0,
    lines: [
      { variantId: null, customItemName: "Special Order Sink", productName: null, sku: null, quantity: 2, actualSellingPrice: 500 },
      { variantId: "unknown", customItemName: null, productName: "Grout", sku: "G-1", quantity: 1, actualSellingPrice: 200 },
    ],
  },
];

test("splits the whole-sale discount across lines and subtracts landed cost", () => {
  const lines = buildProfitLossLines(sales, costs);
  const saleA = lines.filter((line) => line.saleId === "a");
  assert.deepEqual(saleA.map((line) => line.discount), [10, 120]);
  assert.equal(saleA.reduce((total, line) => total + line.sales, 0), 12870);
  const { summary } = summarizeProfitLoss(saleA);
  assert.equal(summary.grossSales, 13000);
  assert.equal(summary.totalDiscounts, 130);
  assert.equal(summary.netSales, 12870);
  assert.equal(summary.costOfGoodsSold, 10050);
  assert.equal(summary.grossProfit, 2820);
});

test("custom items cost their sold price and missing costs are flagged", () => {
  const lines = buildProfitLossLines(sales, costs);
  const custom = lines.find((line) => line.type === "custom");
  assert.equal(custom?.cost, 1000);
  assert.equal(custom?.grossProfit, 0);
  const { summary, items } = summarizeProfitLoss(lines.filter((line) => line.saleId === "b"));
  assert.equal(summary.customItemSales, 1000);
  assert.equal(summary.inStockSales, 200);
  assert.equal(summary.grossProfit, 200);
  assert.equal(summary.unpaidNetSales, 1200);
  assert.equal(summary.missingCostItemCount, 1);
  assert.equal(items.find((item) => item.type === "custom")?.unitCost, 500);
});

test("filtering by type keeps totals consistent", () => {
  const lines = buildProfitLossLines(sales, costs);
  const all = summarizeProfitLoss(lines).summary;
  const inStock = summarizeProfitLoss(lines.filter((line) => line.type === "in_stock")).summary;
  const custom = summarizeProfitLoss(lines.filter((line) => line.type === "custom")).summary;
  assert.equal(inStock.netSales + custom.netSales, all.netSales);
  assert.equal(inStock.grossProfit + custom.grossProfit, all.grossProfit);
  assert.equal(custom.grossProfit, 0);
  assert.equal(custom.saleCount, 1);
});
