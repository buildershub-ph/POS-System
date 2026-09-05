import assert from "node:assert/strict";
import test from "node:test";
import {
  InventoryRuleError,
  reverseLines,
  validateInventoryTransaction,
} from "../lib/inventory-ledger.ts";

const variantId = "10000000-0000-0000-0000-000000000001";
const warehouse = "20000000-0000-0000-0000-000000000001";
const showroom = "20000000-0000-0000-0000-000000000002";

test("receiving only accepts positive inventory", () => {
  const transaction = validateInventoryTransaction({
    type: "receiving",
    lines: [{ variantId, locationId: warehouse, quantityDelta: 12 }],
  });
  assert.equal(transaction.lines[0].quantityDelta, 12);
  assert.throws(
    () => validateInventoryTransaction({ type: "receiving", lines: [{ variantId, locationId: warehouse, quantityDelta: -1 }] }),
    InventoryRuleError,
  );
});

test("transfers must balance each exact variant", () => {
  assert.doesNotThrow(() => validateInventoryTransaction({
    type: "transfer",
    sourceLocationId: warehouse,
    destinationLocationId: showroom,
    lines: [
      { variantId, locationId: warehouse, quantityDelta: -5 },
      { variantId, locationId: showroom, quantityDelta: 5 },
    ],
  }));
  assert.throws(() => validateInventoryTransaction({
    type: "transfer",
    sourceLocationId: warehouse,
    destinationLocationId: showroom,
    lines: [
      { variantId, locationId: warehouse, quantityDelta: -5 },
      { variantId, locationId: showroom, quantityDelta: 4 },
    ],
  }), /net to zero/);
});

test("sales cannot increase stock", () => {
  assert.throws(() => validateInventoryTransaction({
    type: "sale",
    lines: [{ variantId, locationId: showroom, quantityDelta: 1 }],
  }), /cannot increase stock/);
});

test("reversal transactions reference the original and invert all lines", () => {
  const original = [{ variantId, locationId: warehouse, quantityDelta: 8 }];
  assert.deepEqual(reverseLines(original), [{ variantId, locationId: warehouse, quantityDelta: -8 }]);
  assert.throws(() => validateInventoryTransaction({ type: "reversal", lines: reverseLines(original) }), /must reference/);
  assert.doesNotThrow(() => validateInventoryTransaction({
    type: "reversal",
    reversesTransactionId: "30000000-0000-0000-0000-000000000001",
    lines: reverseLines(original),
  }));
});

test("zero-value ledger lines are rejected", () => {
  assert.throws(() => validateInventoryTransaction({
    type: "physical_count_adjustment",
    lines: [{ variantId, locationId: showroom, quantityDelta: 0 }],
  }), /non-zero quantity/);
});

