export const TRANSACTION_HEADER = ["Date", "Merchant", "Description", "Direction", "Amount", "Category", "Confidence", "Source", "Explanation", "Transaction ID"];

export function transactionSheetRow(transaction) {
  return [transaction.date, transaction.merchant, transaction.description, transaction.type, transaction.amount, transaction.category,
    Math.round(transaction.confidence * 100) / 100, transaction.source, transaction.explanation, transaction.id];
}

function comparableCell(value) {
  return typeof value === "number" ? String(Math.round(value * 1000000) / 1000000) : String(value ?? "").trim();
}

// Dates are intentionally excluded from the legacy key because Sheets may localize them.
// Occurrence queues still preserve repeated same-merchant/same-amount transactions one-for-one.
function legacyTransactionKey(row) {
  const amount = Number(String(row[4] ?? "").replace(/[^0-9.-]/g, "")) || 0;
  return [row[1], row[2], row[3], amount.toFixed(2)].map((value) => comparableCell(value).toLowerCase()).join("|");
}

/** Create an idempotent reconciliation plan. Legacy nine-column rows are matched once by their evidence signature. */
export function planTransactionSheetSync(existingRows, transactions) {
  const rows = existingRows.map((values, index) => ({ values, rowNumber: index + 2 }));
  const byId = new Map();
  const legacy = new Map();
  for (const row of rows) {
    const id = comparableCell(row.values[9]);
    if (id) byId.set(id, row);
    else {
      const key = legacyTransactionKey(row.values);
      const queue = legacy.get(key) || [];
      queue.push(row); legacy.set(key, queue);
    }
  }

  const used = new Set();
  const updates = [];
  const appends = [];
  for (const transaction of transactions) {
    const desired = transactionSheetRow(transaction);
    const match = byId.get(transaction.id) || legacy.get(legacyTransactionKey(desired))?.find((row) => !used.has(row.rowNumber));
    if (!match) { appends.push(desired); continue; }
    used.add(match.rowNumber);
    const current = Array.from({ length: TRANSACTION_HEADER.length }, (_, index) => comparableCell(match.values[index]));
    const next = desired.map(comparableCell);
    if (current.some((value, index) => value !== next[index])) updates.push({ rowNumber: match.rowNumber, values: desired });
  }
  return { updates, appends, deleteRowNumbers: rows.filter((row) => !used.has(row.rowNumber)).map((row) => row.rowNumber).sort((a, b) => b - a) };
}
