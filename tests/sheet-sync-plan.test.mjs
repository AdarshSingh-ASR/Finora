import test from "node:test";
import assert from "node:assert/strict";
import { planTransactionSheetSync, transactionSheetRow } from "../lib/sheet-sync-plan.mjs";

function transaction(overrides = {}) {
  return {
    id: "tx-1", date: "2026-06-01", merchant: "Amazon", description: "Amazon order", type: "debit", amount: 899,
    category: "Shopping", confidence: .94, source: "bank.pdf", explanation: "Categorized from narration.", ...overrides,
  };
}

test("Sheets reconciliation appends only new transaction identities", () => {
  const first = transaction();
  const second = transaction({ id: "tx-2", date: "2026-06-02", merchant: "Swiggy", description: "Swiggy order", amount: 320, category: "Food & Dining" });
  const plan = planTransactionSheetSync([transactionSheetRow(first)], [first, second]);
  assert.equal(plan.appends.length, 1);
  assert.equal(plan.appends[0][9], "tx-2");
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.deleteRowNumbers, []);
});

test("Sheets reconciliation updates changed rows and removes stale rows without reuploading matches", () => {
  const first = transaction();
  const stale = transaction({ id: "tx-old", merchant: "Old merchant", description: "Removed row", amount: 12 });
  const corrected = { ...first, category: "Bills & Utilities", confidence: 1 };
  const plan = planTransactionSheetSync([transactionSheetRow(first), transactionSheetRow(stale)], [corrected]);
  assert.equal(plan.appends.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].rowNumber, 2);
  assert.equal(plan.updates[0].values[5], "Bills & Utilities");
  assert.deepEqual(plan.deleteRowNumbers, [3]);
});

test("legacy nine-column rows are upgraded in place despite localized dates", () => {
  const first = transaction();
  const legacy = transactionSheetRow(first).slice(0, 9);
  legacy[0] = "01/06/2026";
  const plan = planTransactionSheetSync([legacy], [first]);
  assert.equal(plan.appends.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].values[9], "tx-1");
  assert.deepEqual(plan.deleteRowNumbers, []);
});
