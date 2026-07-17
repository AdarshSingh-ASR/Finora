import assert from "node:assert/strict";
import test from "node:test";
import { classifyNarration, normalizeMerchantName, refineTransactionsForAnalysis } from "../lib/transaction-classifier.mjs";
import { analyzeFinances, explainSpendingChange } from "../lib/finance-intelligence.mjs";

const row = (id, date, merchant, description, amount, category = "Miscellaneous", type = "debit") => ({
  id, date, merchant, description, amount, type, category, confidence: .42, source: "test", explanation: "Legacy catch-all category.",
});

test("merchant and narration evidence replaces catch-all categories", () => {
  const fixtures = [
    ["Global Fashion Off Duty Limited", "UPI payment to Global Fashion Off Duty Limited", "Shopping", "Global Fashion Off Duty"],
    ["OYO", "Card payment at OYO Rooms Bengaluru", "Travel", "OYO Rooms"],
    ["CESC KOLKATA", "BBPS electricity bill CESC Kolkata", "Bills & Utilities", "CESC"],
    ["Apollo", "UPI payment Apollo Pharmacy", "Health", "Apollo Pharmacy"],
    ["School", "Annual school tuition fee", "Education", "School"],
  ];
  for (const [merchant, description, category, normalized] of fixtures) {
    const classified = classifyNarration({ merchant, description, type: "debit" });
    assert.equal(classified.category, category);
    assert.equal(classified.merchant, normalized);
    assert.ok(classified.confidence >= .72);
  }
});

test("person-to-person movement remains a transfer and preserves a useful counterparty", () => {
  const classified = classifyNarration({ merchant: "", description: "Received from DHARMENDRA SINGH UPI Transaction ID 615223538205", type: "credit" });
  assert.equal(classified.category, "Transfers");
  assert.equal(classified.merchant, "Dharmendra Singh");
  assert.equal(normalizeMerchantName("Paid to AKASH KUMAR PRASAD UPI Transaction ID 998625"), "Akash Kumar Prasad");
});

test("miscellaneous remains only when evidence is genuinely insufficient", () => {
  const classified = classifyNarration({ merchant: "Unknown merchant", description: "Unclear adjustment", type: "debit" });
  assert.equal(classified.category, "Miscellaneous");
  assert.ok(classified.confidence < .5);
});

test("existing catch-all ledgers produce specific analytical drivers without being mutated", () => {
  const legacy = [
    row("a", "2026-06-02", "Unknown Merchant", "Card payment at OYO Rooms", 1800, "Other"),
    row("b", "2026-06-04", "Dharmendra Singh", "UPI paid to DHARMENDRA SINGH Transaction ID 12345678", 5000),
    row("c", "2026-07-02", "Global Fashion Off Duty Limited", "POS Global Fashion Off Duty Limited", 2129),
    row("d", "2026-07-04", "CESC Kolkata", "BBPS electricity bill CESC Kolkata", 230),
  ];
  const refined = refineTransactionsForAnalysis(legacy);
  assert.equal(legacy[0].category, "Other", "source evidence must not be mutated");
  assert.equal(refined.find((item) => item.id === "a").category, "Travel");
  assert.equal(refined.find((item) => item.id === "b").category, "Transfers");
  const change = explainSpendingChange(legacy, "2026-07", "2026-06");
  assert.ok(change.categoryDrivers.some((item) => item.category === "Shopping"));
  assert.ok(!change.categoryDrivers.some((item) => item.category === "Other"));
  const analysis = analyzeFinances(legacy, [], "2026-07");
  assert.equal(analysis.byCategory[0].category, "Shopping");
  assert.equal(analysis.topMerchants[0].merchant, "Global Fashion Off Duty");
});
