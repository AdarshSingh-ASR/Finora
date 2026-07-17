import type { Budget, Category, DuplicateMatch, SpendingAnomaly, StatementResult, Subscription, Transaction } from "./types";
import { categoryValues, classifyNarration, normalizeMerchantName, refineTransaction, refineTransactionsForAnalysis, transactionDetail } from "./transaction-classifier.mjs";

export {
  analyzeFinances,
  buildCashFlow,
  buildFinanceGraph,
  buildFinancialTimeline,
  classifyTransaction,
  explainBudgetExceeded,
  explainSpendingChange,
  financialHealthReport,
  findCostCutting,
  findSavingsOpportunities,
  predictMonthEndSpending,
  suggestBudgets,
} from "./finance-intelligence.mjs";

export const categories: Category[] = categoryValues;
export { classifyNarration, refineTransaction, refineTransactionsForAnalysis, transactionDetail };

export function money(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function normalizeMerchant(raw: string) {
  return normalizeMerchantName(raw);
}

export function periodKey(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date.slice(0, 7) : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

export function latestPeriod(transactions: Transaction[]) {
  return [...new Set(transactions.map((transaction) => periodKey(transaction.date)))].sort().at(-1) || "";
}

export function inPeriod(transactions: Transaction[], period = latestPeriod(transactions)) {
  return transactions.filter((transaction) => periodKey(transaction.date) === period);
}

export function summarize(transactions: Transaction[]) {
  const refined = refineTransactionsForAnalysis(transactions);
  const income = refined.filter((t) => t.type === "credit" && !["Transfers", "Investment"].includes(t.category)).reduce((a, t) => a + t.amount, 0);
  const spend = refined.filter((t) => t.type === "debit" && !["Transfers", "Investment"].includes(t.category)).reduce((a, t) => a + t.amount, 0);
  const transfersOnly = refined.filter((t) => t.type === "debit" && t.category === "Transfers").reduce((a, t) => a + t.amount, 0);
  const investmentContributions = refined.filter((t) => t.type === "debit" && t.category === "Investment").reduce((a, t) => a + t.amount, 0);
  const transfers = transfersOnly + investmentContributions;
  const byCategory = refined.filter((t) => t.type === "debit" && !["Transfers", "Investment"].includes(t.category)).reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount; return acc;
  }, {});
  const totalOutflow = spend + transfers;
  const netCashFlow = income - totalOutflow;
  return { income, spend, consumption: spend, transfers, transfersOnly, investmentContributions, totalOutflow, saved: netCashFlow, netCashFlow, savingsRate: income ? ((income - spend) / income) * 100 : 0, cashRetentionRate: income ? (netCashFlow / income) * 100 : 0, byCategory };
}

export function monthlySummaries(transactions: Transaction[]) {
  const periods = [...new Set(transactions.map((transaction) => periodKey(transaction.date)))].sort();
  return periods.map((period) => ({ period, ...summarize(inPeriod(transactions, period)) }));
}

export function compareMonths(transactions: Transaction[], current = latestPeriod(transactions), previous?: string) {
  const periods = [...new Set(transactions.map((transaction) => periodKey(transaction.date)))].sort();
  const previousPeriod = previous || periods[periods.indexOf(current) - 1] || "";
  const currentSummary = summarize(inPeriod(transactions, current));
  const previousSummary = summarize(inPeriod(transactions, previousPeriod));
  const change = (now: number, before: number) => before ? ((now - before) / before) * 100 : null;
  const categories = [...new Set([...Object.keys(currentSummary.byCategory), ...Object.keys(previousSummary.byCategory)])];
  return {
    current, previous: previousPeriod, currentSummary, previousSummary,
    spendChangePercent: change(currentSummary.spend, previousSummary.spend),
    categoryChanges: categories.map((category) => ({ category, current: currentSummary.byCategory[category] || 0, previous: previousSummary.byCategory[category] || 0, changePercent: change(currentSummary.byCategory[category] || 0, previousSummary.byCategory[category] || 0) })).sort((a, b) => Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0)),
  };
}

export function detectSubscriptions(transactions: Transaction[]): Subscription[] {
  const debits = refineTransactionsForAnalysis(transactions).filter((transaction) => transaction.type === "debit" && !["Transfers", "Investment"].includes(transaction.category));
  const groups = debits.reduce<Record<string, Transaction[]>>((acc, transaction) => {
    const merchant = normalizeMerchant(transaction.merchant || transaction.description);
    (acc[merchant] ||= []).push(transaction); return acc;
  }, {});
  const knownRecurring = /Netflix|Spotify|ChatGPT|Claude|Cult\.fit|Prime|Google One|Apple|Canva/i;
  return Object.entries(groups).flatMap(([merchant, items]) => {
    const sorted = items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const amounts = sorted.map((item) => item.amount); const average = amounts.reduce((a, n) => a + n, 0) / amounts.length;
    const stableAmount = amounts.every((amount) => Math.abs(amount - average) / Math.max(average, 1) <= .12);
    const intervals = sorted.slice(1).map((item, index) => (new Date(item.date).getTime() - new Date(sorted[index].date).getTime()) / 86400000);
    const monthlyCadence = intervals.some((days) => days >= 24 && days <= 38);
    if (!(items.length >= 2 && stableAmount && monthlyCadence) && !(knownRecurring.test(merchant) && items.length >= 1)) return [];
    const last = new Date(sorted.at(-1)!.date); last.setDate(last.getDate() + 30);
    return [{ merchant, monthlyCost: Math.round(average), annualCost: Math.round(average * 12), occurrences: items.length, estimatedRenewalDate: last.toISOString().slice(0, 10), confidence: items.length >= 2 && monthlyCadence ? .94 : .72, transactionIds: items.map((item) => item.id) }];
  }).sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export function findDuplicateTransactions(transactions: Transaction[]): DuplicateMatch[] {
  const sorted = transactions.filter((t) => t.type === "debit").sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const matches: DuplicateMatch[] = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < Math.min(sorted.length, i + 5); j++) {
    const first = sorted[i], second = sorted[j];
    const hasFirstTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(first.date), hasSecondTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(second.date);
    if (!hasFirstTime || !hasSecondTime) continue;
    const minutes = Math.abs(new Date(second.date).getTime() - new Date(first.date).getTime()) / 60000;
    if (normalizeMerchant(first.merchant) === normalizeMerchant(second.merchant) && Math.abs(first.amount - second.amount) <= 1 && minutes <= 2) matches.push({ id: `dup-${first.id}-${second.id}`, merchant: normalizeMerchant(first.merchant), amount: first.amount, minutesApart: Math.round(minutes), transactionIds: [first.id, second.id] });
  }
  return matches;
}

export function detectAnomalies(transactions: Transaction[]): SpendingAnomaly[] {
  const anomalies: SpendingAnomaly[] = [];
  const latest = latestPeriod(transactions); const previous = compareMonths(transactions, latest);
  previous.categoryChanges.filter((item) => item.previous > 0 && item.current - item.previous > 1000 && (item.changePercent || 0) >= 50).slice(0, 3).forEach((item) => anomalies.push({ id: `cat-${item.category}`, severity: (item.changePercent || 0) >= 100 ? "high" : "medium", title: `${item.category} jumped ${Math.round(item.changePercent || 0)}%`, detail: `${money(item.current)} this month versus ${money(item.previous)} previously.` }));
  const historicalMerchants = new Set(transactions.filter((t) => periodKey(t.date) !== latest).map((t) => normalizeMerchant(t.merchant)));
  inPeriod(transactions, latest).filter((t) => t.type === "debit" && t.amount >= 4999 && !historicalMerchants.has(normalizeMerchant(t.merchant))).slice(0, 3).forEach((transaction) => anomalies.push({ id: `new-${transaction.id}`, severity: transaction.amount >= 10000 ? "high" : "medium", title: `New merchant charged ${money(transaction.amount)}`, detail: `${normalizeMerchant(transaction.merchant)} has not appeared in earlier imported periods.`, transactionId: transaction.id }));
  return anomalies;
}

export function budgetStatus(transactions: Transaction[], budgets: Budget[], period = latestPeriod(transactions)) {
  const byCategory = summarize(inPeriod(transactions, period)).byCategory;
  return budgets.map((budget) => { const spent = byCategory[budget.category] || 0; return { ...budget, spent, remaining: budget.limit - spent, usedPercent: budget.limit ? (spent / budget.limit) * 100 : 0, status: spent > budget.limit ? "over" : spent / budget.limit >= .8 ? "warning" : "on-track" }; });
}

export function financialHealthScore(transactions: Transaction[], budgets: Budget[] = []) {
  const period = latestPeriod(transactions); const current = inPeriod(transactions, period); const totals = summarize(current);
  const subscriptions = detectSubscriptions(transactions); const statuses = budgetStatus(transactions, budgets, period);
  const savings = Math.max(0, Math.min(35, totals.savingsRate * .7));
  const budget = Math.max(0, 25 - statuses.filter((item) => item.status === "over").length * 8 - statuses.filter((item) => item.status === "warning").length * 3);
  const recurringRatio = totals.income ? subscriptions.reduce((a, item) => a + item.monthlyCost, 0) / totals.income : 0;
  const recurring = Math.max(0, 20 - recurringRatio * 100);
  const anomalies = Math.max(0, 20 - detectAnomalies(transactions).length * 4);
  const breakdown = { savings: Math.round(savings), ...(statuses.length ? { budget: Math.round(budget) } : {}), recurring: Math.round(recurring), consistency: Math.round(anomalies) };
  const score = Math.round(Object.values(breakdown).reduce((total, value) => total + value, 0) / (statuses.length ? 100 : 75) * 100);
  return { score, label: score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 45 ? "Needs attention" : "At risk", breakdown, period };
}

export function weeklyReport(transactions: Transaction[]) {
  transactions = refineTransactionsForAnalysis(transactions);
  const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
  const week = transactions.filter((t) => { const date = new Date(t.date); return date >= start && date <= end && t.type === "debit" && !["Transfers", "Investment"].includes(t.category); });
  const totals = summarize(week); const categories = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]);
  const merchants = week.reduce<Record<string, number>>((acc, t) => { const merchant = normalizeMerchant(t.merchant); acc[merchant] = (acc[merchant] || 0) + t.amount; return acc; }, {});
  const topMerchant = Object.entries(merchants).sort((a, b) => b[1] - a[1])[0]; const largest = [...week].sort((a, b) => b.amount - a.amount)[0];
  const recurring = detectSubscriptions(transactions).filter((item) => week.some((transaction) => normalizeMerchant(transaction.merchant || transaction.description) === item.merchant));
  const suggestion = categories[0]
    ? `${categories[0][0]} led consumption at ${money(categories[0][1])}${topMerchant ? `, with ${topMerchant[0]} contributing ${money(topMerchant[1])}` : ""}.${recurring.length ? ` ${recurring.length} recurring expense${recurring.length === 1 ? " was" : "s were"} active this period.` : ""}`
    : "No consumption spending was detected in this period; transfers and investments remain separate.";
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), spent: totals.spend, topCategory: categories[0]?.[0] || "None", topCategoryAmount: categories[0]?.[1] || 0, topMerchant: topMerchant?.[0] || "None", largestExpense: largest ? { merchant: normalizeMerchant(largest.merchant), amount: largest.amount, category: largest.category, date: largest.date } : null, recurringExpenses: recurring.slice(0, 4), suggestion };
}

export function answerFinanceQuestion(question: string, transactions: Transaction[], budgets: Budget[] = []) {
  const lower = question.toLowerCase(); const current = inPeriod(transactions); const totals = summarize(current); const comparison = compareMonths(transactions); const subscriptions = detectSubscriptions(transactions); const duplicates = findDuplicateTransactions(transactions);
  const allDebitByCategory = current.filter((t) => t.type === "debit").reduce<Record<string, number>>((acc, t) => { acc[t.category] = (acc[t.category] || 0) + t.amount; return acc; }, {});
  if (/subscription|recurring/.test(lower)) return `I found ${subscriptions.length} recurring charges costing about ${money(subscriptions.reduce((a, item) => a + item.monthlyCost, 0))}/month: ${subscriptions.map((item) => item.merchant).join(", ") || "none yet"}.`;
  if (/duplicate|charged.*twice/.test(lower)) return duplicates.length ? `${duplicates.length} possible duplicate found: ${duplicates.map((item) => `${item.merchant} ${money(item.amount)}`).join(", ")}.` : "I found no same-merchant, same-amount payments within two minutes.";
  if (/compare|last month|june|july/.test(lower)) { const currentOutflow = comparison.currentSummary.spend + comparison.currentSummary.transfers; const previousOutflow = comparison.previousSummary.spend + comparison.previousSummary.transfers; const change = previousOutflow ? ((currentOutflow - previousOutflow) / previousOutflow) * 100 : null; return change == null ? `Total outflow in ${comparison.current} was ${money(currentOutflow)}. Import a prior month with debit transactions for a percentage comparison.` : `Total outflow is ${Math.abs(change).toFixed(0)}% ${change >= 0 ? "higher" : "lower"} than ${comparison.previous}: ${money(currentOutflow)} versus ${money(previousOutflow)}. This includes person-to-person transfers and investments, shown separately from consumption spending.`; }
  if (/average daily|per day/.test(lower)) { const debits = current.filter((t) => t.type === "debit"); const activeDays = new Set(debits.map((t) => t.date.slice(0, 10))).size; const outflow = debits.reduce((sum, t) => sum + t.amount, 0); return `Your average daily outflow across ${activeDays || 0} active day${activeDays === 1 ? "" : "s"} in ${latestPeriod(transactions)} is ${money(outflow / Math.max(1, activeDays))}, including person-to-person transfers and investments.`; }
  if (/coffee/.test(lower)) { const items = current.filter((t) => /coffee|cafe|starbucks|blue tokai/i.test(`${t.merchant} ${t.description}`)); return `You spent ${money(items.reduce((a, t) => a + t.amount, 0))} on coffee across ${items.length} payments.`; }
  if (/budget/.test(lower)) { const warning = budgetStatus(transactions, budgets).sort((a, b) => b.usedPercent - a.usedPercent)[0]; return warning ? `${warning.category} is your tightest budget at ${warning.usedPercent.toFixed(0)}% used (${money(warning.spent)} of ${money(warning.limit)}).` : "No budgets are configured."; }
  const top = Object.entries(allDebitByCategory).sort((a, b) => b[1] - a[1])[0];
  return `${top?.[0] || "Spending"} is your largest outgoing category at ${money(top?.[1] || 0)}. Your total outflow was ${money(totals.spend + totals.transfers)} in ${latestPeriod(transactions)}, including person-to-person transfers and investments.`;
}

export function parseCsvFallback(text: string, filename = "statement.csv"): StatementResult | null {
  const lines = text.split(/\r?\n/).filter(Boolean); if (lines.length < 2) return null;
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const split = (line: string) => line.split(new RegExp(`${delimiter}(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)`)).map((v) => v.replace(/^\"|\"$/g, "").trim());
  const headers = split(lines[0]).map((h) => h.toLowerCase()); const find = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const dateIndex = find("date", "txn date", "transaction date"), descIndex = find("description", "narration", "details", "merchant", "particular", "remark"), debitIndex = find("debit", "withdrawal"), creditIndex = find("credit", "deposit"), amountIndex = find("amount"), typeIndex = find("type", "dr/cr");
  if (dateIndex < 0 || descIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) return null;
  const transactions = lines.slice(1).map((line, index) => {
    const row = split(line); const clean = (v = "") => Number(v.replace(/[^0-9.-]/g, "")) || 0; const creditAmount = creditIndex >= 0 ? clean(row[creditIndex]) : 0, debitAmount = debitIndex >= 0 ? clean(row[debitIndex]) : 0; const isCredit = creditAmount > 0 || /cr|credit|deposit/.test(typeIndex >= 0 ? row[typeIndex]?.toLowerCase() : ""); const amount = amountIndex >= 0 ? Math.abs(clean(row[amountIndex])) : (creditAmount || debitAmount); const description = row[descIndex] || "Unknown transaction";
    const classified = classifyNarration({ description, type: isCredit ? "credit" : "debit" });
    return { id: `import-${index + 1}`, date: row[dateIndex] || "", merchant: classified.merchant, description, amount, type: isCredit ? "credit" as const : "debit" as const, category: classified.category, confidence: classified.confidence, source: filename, explanation: classified.reason };
  }).filter((t) => t.amount > 0 && Boolean(t.date) && Boolean(t.description));
  if (!transactions.length) return null; const totals = summarize(inPeriod(transactions)); const top = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])[0];
  return { accountName: "Imported account", bankName: filename, period: "Imported statement", currency: "INR", transactions, insights: [`${transactions.length} transactions were normalized from ${filename}.`, top ? `${top[0]} is your largest spend category at ${money(top[1])}.` : "No debit transactions found.", `Total outflow in the latest period is ${money(totals.spend)}.`], provider: "local" };
}
