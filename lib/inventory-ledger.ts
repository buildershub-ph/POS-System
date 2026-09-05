import type {
  InventoryLineInput,
  InventoryTransactionInput,
} from "./types";

export class InventoryRuleError extends Error {}

function assertWholeFiniteQuantity(line: InventoryLineInput) {
  if (!Number.isFinite(line.quantityDelta) || line.quantityDelta === 0) {
    throw new InventoryRuleError("Every ledger line needs a non-zero quantity.");
  }
}

export function validateInventoryTransaction(
  transaction: InventoryTransactionInput,
): InventoryTransactionInput {
  if (!transaction.lines.length) {
    throw new InventoryRuleError("An inventory transaction needs at least one line.");
  }

  transaction.lines.forEach(assertWholeFiniteQuantity);

  if (transaction.type === "transfer") {
    if (!transaction.sourceLocationId || !transaction.destinationLocationId) {
      throw new InventoryRuleError("Transfers require source and destination locations.");
    }
    if (transaction.sourceLocationId === transaction.destinationLocationId) {
      throw new InventoryRuleError("Transfer locations must be different.");
    }

    const byVariant = new Map<string, number>();
    for (const line of transaction.lines) {
      byVariant.set(
        line.variantId,
        (byVariant.get(line.variantId) ?? 0) + line.quantityDelta,
      );
    }
    if ([...byVariant.values()].some((quantity) => quantity !== 0)) {
      throw new InventoryRuleError("Every transfer variant must net to zero.");
    }
  }

  if (transaction.type === "reversal" && !transaction.reversesTransactionId) {
    throw new InventoryRuleError("A reversal must reference the posted transaction it reverses.");
  }

  if (transaction.type === "receiving" && transaction.lines.some((line) => line.quantityDelta < 0)) {
    throw new InventoryRuleError("Receiving lines cannot reduce stock.");
  }

  if (
    ["sale", "supplier_return", "damaged"].includes(transaction.type) &&
    transaction.lines.some((line) => line.quantityDelta > 0)
  ) {
    throw new InventoryRuleError(`${transaction.type} lines cannot increase stock.`);
  }

  return transaction;
}

export function reverseLines(lines: InventoryLineInput[]): InventoryLineInput[] {
  return lines.map((line) => ({ ...line, quantityDelta: -line.quantityDelta }));
}

