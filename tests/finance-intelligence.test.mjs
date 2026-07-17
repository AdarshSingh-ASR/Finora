import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeFinances, buildCashFlow, buildFinanceGraph, buildFinancialTimeline,
  explainBudgetExceeded, explainSpendingChange, financialHealthReport,
  findCostCutting, predictMonthEndSpending, suggestBudgets,
} from "../lib/finance-intelligence.mjs";

const tx = (id, date, merchant, amount, type, category, description = merchant) => ({ id, date, merchant, amount, type, category, description, confidence: .93, source: "test", explanation: "Synthetic deterministic fixture." });
const ledger = [];
for (let month = 1; month <= 6; month += 1) {
  const mm = String(month).padStart(2, "0");
  ledger.push(tx(`salary-${mm}`, `2026-${mm}-01`, "Acme Payroll", 50000, "credit", "Salary"));
  ledger.push(tx(`rent-${mm}`, `2026-${mm}-02`, "Landlord", 12000, "debit", "Housing"));
  ledger.push(tx(`netflix-${mm}`, `2026-${mm}-05`, "Netflix", 649, "debit", "Entertainment"));
  ledger.push(tx(`food-${mm}`, `2026-${mm}-12`, month >= 5 ? "Swiggy" : "Fresh Market", month === 6 ? 4200 : 1800 + month * 100, "debit", "Food & Dining"));
  ledger.push(tx(`sip-${mm}`, `2026-${mm}-10`, "Index Fund SIP", month === 6 ? 5000 : 3000, "debit", "Investment"));
}
ledger.push(tx("friend-jun", "2026-06-18", "Aarav", 2500, "debit", "Transfers"));
ledger.push(tx("travel-jun", "2026-06-20", "Indigo", 9800, "debit", "Travel"));
const budgets = [{ category: "Food & Dining", limit: 3000 }, { category: "Travel", limit: 8000 }];

test("finance intelligence separates cash-flow classes and retains evidence", () => {
  const flow = buildCashFlow(ledger, "2026-06");
  assert.equal(flow.income, 50000);
  assert.equal(flow.consumption, 12000 + 649 + 4200 + 9800);
  assert.equal(flow.transfers, 2500);
  assert.equal(flow.investmentContributions, 5000);
  assert.equal(flow.totalOutflow, flow.consumption + 7500);

  const analysis = analyzeFinances(ledger, budgets, "2026-06");
  assert.deepEqual(analysis.cashFlow, flow);
  assert.ok(analysis.classificationTotals.fixed >= 12649);
  assert.ok(analysis.classificationTotals.variable > 0);
  assert.ok(analysis.topMerchants.some((item) => item.merchant === "Landlord"));
  assert.ok(analysis.subscriptions.some((item) => item.merchant === "Netflix"));
  assert.ok(analysis.graph.edges.some((edge) => edge.type === "RECURS_AS"));
});

test("timeline, explanations, budgets, forecast and health remain deterministic", () => {
  const timeline = buildFinancialTimeline(ledger, budgets, 6);
  assert.ok(timeline.length > 0);
  assert.ok(timeline.every((event) => event.period >= "2026-01" && event.period <= "2026-06"));
  assert.ok(timeline.every((event) => event.evidenceTransactionIds.length > 0 || event.type === "savings_rate"));
  const change = explainSpendingChange(ledger, "2026-06", "2026-05");
  assert.ok(change.categoryDrivers.some((item) => item.category === "Travel"));
  const exceeded = explainBudgetExceeded(ledger, budgets, undefined, "2026-06");
  assert.equal(exceeded.exceeded.length, 2);
  const forecast = predictMonthEndSpending(ledger, "2026-06");
  assert.ok(forecast.projectedConsumption >= forecast.actualConsumption);
  assert.ok(["low", "medium", "high"].includes(forecast.confidence));
  assert.ok(suggestBudgets(ledger).length > 0);
  assert.ok(financialHealthReport(ledger, budgets, "2026-06").score <= 100);
  assert.ok(findCostCutting(ledger, "2026-06").opportunities.some((item) => item.evidenceTransactionIds.length));
  const graph = buildFinanceGraph(ledger, budgets);
  assert.ok(graph.nodes.some((node) => node.type === "budget"));
  assert.ok(graph.edges.some((edge) => edge.type === "HAS_BUDGET"));
});

test("empty and one-month ledgers produce bounded, honest outputs", () => {
  const empty = analyzeFinances([], [], undefined);
  assert.equal(empty.cashFlow.totalOutflow, 0);
  assert.equal(empty.timeline.length, 0);
  assert.equal(empty.forecast.confidence, "low");
  const oneMonth = analyzeFinances(ledger.filter((item) => item.date.startsWith("2026-06")), budgets, "2026-06");
  assert.equal(oneMonth.previousCashFlow, undefined);
  assert.equal(oneMonth.consumptionChangePercent, null);
});
