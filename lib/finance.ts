import type { Budget, Category, DuplicateMatch, SpendingAnomaly, StatementResult, Subscription, Transaction } from "./types";

export const categories: Category[] = [
  "Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities",
  "EMI", "Investment", "Health", "Entertainment", "Travel", "Salary",
  "Income", "Transfers", "Miscellaneous", "Other",
];

export const defaultBudgets: Budget[] = [
  { category: "Food & Dining", limit: 8000 },
  { category: "Transport", limit: 4000 },
  { category: "Shopping", limit: 6000 },
  { category: "Entertainment", limit: 2500 },
];

export function money(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function normalizeMerchant(raw: string) {
  const value = raw.toUpperCase().replace(/\b(UPI|P2M|P2P|POS|ACH|SI|BBPS|NEFT|IMPS|TXN|REF)\b/g, " ").replace(/\b\d{6,}\b/g, " ").replace(/[\/_*\-]+/g, " ").replace(/\s+/g, " ").trim();
  const known: [RegExp, string][] = [
    [/AMZN|AMAZON/, "Amazon"], [/SWIGGY/, "Swiggy"], [/ZOMATO/, "Zomato"],
    [/BLINKIT|GROFERS/, "Blinkit"], [/UBER/, "Uber"], [/OLA CABS?/, "Ola"],
    [/NETFLIX/, "Netflix"], [/SPOTIFY/, "Spotify"], [/OPENAI|CHATGPT/, "ChatGPT"],
    [/ANTHROPIC|CLAUDE/, "Claude"], [/GOOGLE ONE/, "Google One"], [/APPLE/, "Apple"],
    [/CULT|CUREFIT/, "Cult.fit"], [/PRIME/, "Amazon Prime"], [/CANVA/, "Canva"],
    [/MYNTRA/, "Myntra"], [/INDIGO/, "IndiGo"], [/RELIANCE JIO|\bJIO\b/, "Jio"],
    [/BESCOM/, "BESCOM"], [/BLUE TOKAI/, "Blue Tokai"],
  ];
  const matched = known.find(([pattern]) => pattern.test(value));
  if (matched) return matched[1];
  return value.split(" ").filter(Boolean).slice(0, 4).map((part) => part[0] + part.slice(1).toLowerCase()).join(" ") || "Unknown merchant";
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
  const income = transactions.filter((t) => t.type === "credit").reduce((a, t) => a + t.amount, 0);
  const spend = transactions.filter((t) => t.type === "debit" && !["Transfers", "Investment"].includes(t.category)).reduce((a, t) => a + t.amount, 0);
  const transfers = transactions.filter((t) => t.type === "debit" && ["Transfers", "Investment"].includes(t.category)).reduce((a, t) => a + t.amount, 0);
  const byCategory = transactions.filter((t) => t.type === "debit" && !["Transfers", "Investment"].includes(t.category)).reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount; return acc;
  }, {});
  return { income, spend, transfers, saved: income - spend - transfers, savingsRate: income ? ((income - spend - transfers) / income) * 100 : 0, byCategory };
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

function guessCategory(description: string, credit: boolean): Category {
  if (credit) return /salary|payroll/i.test(description) ? "Salary" : "Income";
  const s = description.toLowerCase();
  if (/emi|loan repayment|bajaj finance|home loan|car loan/.test(s)) return "EMI";
  if (/sip|mutual fund|index fund|zerodha|groww|investment/.test(s)) return "Investment";
  if (/swiggy|zomato|blinkit|zepto|restaurant|cafe|coffee|food|grocery/.test(s)) return "Food & Dining";
  if (/rent|housing|maintenance/.test(s)) return "Housing";
  if (/uber|ola|rapido|metro|fuel|petrol|irctc/.test(s)) return "Transport";
  if (/amazon|flipkart|myntra|ajio|retail/.test(s)) return "Shopping";
  if (/electric|bescom|airtel|jio|broadband|water|gas|bbps/.test(s)) return "Bills & Utilities";
  if (/hospital|pharmacy|medical|cult|gym|health/.test(s)) return "Health";
  if (/netflix|spotify|cinema|bookmyshow|hotstar|prime|canva|chatgpt|claude/.test(s)) return "Entertainment";
  if (/airline|indigo|hotel|makemytrip|booking/.test(s)) return "Travel";
  if (/transfer|imps|p2p/.test(s)) return "Transfers";
  return "Miscellaneous";
}

export function detectSubscriptions(transactions: Transaction[]): Subscription[] {
  const debits = transactions.filter((transaction) => transaction.type === "debit");
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

export function financialHealthScore(transactions: Transaction[], budgets: Budget[] = defaultBudgets) {
  const period = latestPeriod(transactions); const current = inPeriod(transactions, period); const totals = summarize(current);
  const subscriptions = detectSubscriptions(transactions); const statuses = budgetStatus(transactions, budgets, period);
  const savings = Math.max(0, Math.min(35, totals.savingsRate * .7));
  const budget = statuses.length ? Math.max(0, 25 - statuses.filter((item) => item.status === "over").length * 8 - statuses.filter((item) => item.status === "warning").length * 3) : 15;
  const recurringRatio = totals.income ? subscriptions.reduce((a, item) => a + item.monthlyCost, 0) / totals.income : 0;
  const recurring = Math.max(0, 20 - recurringRatio * 100);
  const anomalies = Math.max(0, 20 - detectAnomalies(transactions).length * 4);
  const score = Math.round(savings + budget + recurring + anomalies);
  return { score, label: score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 45 ? "Needs attention" : "At risk", breakdown: { savings: Math.round(savings), budget: Math.round(budget), recurring: Math.round(recurring), consistency: Math.round(anomalies) }, period };
}

export function weeklyReport(transactions: Transaction[]) {
  const sorted = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const end = new Date(sorted[0]?.date || Date.now()); const start = new Date(end); start.setDate(start.getDate() - 6);
  const week = transactions.filter((t) => { const date = new Date(t.date); return date >= start && date <= end && t.type === "debit" && !["Transfers", "Investment"].includes(t.category); });
  const totals = summarize(week); const categories = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]);
  const merchants = week.reduce<Record<string, number>>((acc, t) => { const merchant = normalizeMerchant(t.merchant); acc[merchant] = (acc[merchant] || 0) + t.amount; return acc; }, {});
  const topMerchant = Object.entries(merchants).sort((a, b) => b[1] - a[1])[0]; const largest = [...week].sort((a, b) => b.amount - a.amount)[0];
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), spent: totals.spend, topCategory: categories[0]?.[0] || "None", topCategoryAmount: categories[0]?.[1] || 0, topMerchant: topMerchant?.[0] || "None", largestExpense: largest ? { merchant: normalizeMerchant(largest.merchant), amount: largest.amount } : null, suggestion: categories[0] ? `Reducing ${categories[0][0]} by 15% would save about ${money(categories[0][1] * .15)} per week.` : "Keep importing transactions to receive a useful suggestion." };
}

export function answerFinanceQuestion(question: string, transactions: Transaction[], budgets = defaultBudgets) {
  const lower = question.toLowerCase(); const current = inPeriod(transactions); const totals = summarize(current); const comparison = compareMonths(transactions); const subscriptions = detectSubscriptions(transactions); const duplicates = findDuplicateTransactions(transactions);
  if (/subscription|recurring/.test(lower)) return `I found ${subscriptions.length} recurring charges costing about ${money(subscriptions.reduce((a, item) => a + item.monthlyCost, 0))}/month: ${subscriptions.map((item) => item.merchant).join(", ") || "none yet"}.`;
  if (/duplicate|charged.*twice/.test(lower)) return duplicates.length ? `${duplicates.length} possible duplicate found: ${duplicates.map((item) => `${item.merchant} ${money(item.amount)}`).join(", ")}.` : "I found no same-merchant, same-amount payments within two minutes.";
  if (/compare|last month|june|july/.test(lower)) return comparison.spendChangePercent == null ? "Import at least two months to compare spending." : `Spending is ${Math.abs(comparison.spendChangePercent).toFixed(0)}% ${comparison.spendChangePercent >= 0 ? "higher" : "lower"} than ${comparison.previous}: ${money(comparison.currentSummary.spend)} versus ${money(comparison.previousSummary.spend)}.`;
  if (/average daily|per day/.test(lower)) return `Your average daily spending this month is ${money(totals.spend / Math.max(1, new Date().getDate()))}.`;
  if (/coffee/.test(lower)) { const items = current.filter((t) => /coffee|cafe|starbucks|blue tokai/i.test(`${t.merchant} ${t.description}`)); return `You spent ${money(items.reduce((a, t) => a + t.amount, 0))} on coffee across ${items.length} payments.`; }
  if (/budget/.test(lower)) { const warning = budgetStatus(transactions, budgets).sort((a, b) => b.usedPercent - a.usedPercent)[0]; return warning ? `${warning.category} is your tightest budget at ${warning.usedPercent.toFixed(0)}% used (${money(warning.spent)} of ${money(warning.limit)}).` : "No budgets are configured."; }
  const top = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])[0];
  return `${top?.[0] || "Spending"} is your largest category at ${money(top?.[1] || 0)}. You spent ${money(totals.spend)} and saved ${money(totals.saved)} in ${latestPeriod(transactions)}.`;
}

export function parseCsvFallback(text: string, filename = "statement.csv"): StatementResult | null {
  const lines = text.split(/\r?\n/).filter(Boolean); if (lines.length < 2) return null;
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const split = (line: string) => line.split(new RegExp(`${delimiter}(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)`)).map((v) => v.replace(/^\"|\"$/g, "").trim());
  const headers = split(lines[0]).map((h) => h.toLowerCase()); const find = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const dateIndex = find("date", "txn date", "transaction date"), descIndex = find("description", "narration", "details", "merchant", "particular", "remark"), debitIndex = find("debit", "withdrawal"), creditIndex = find("credit", "deposit"), amountIndex = find("amount"), typeIndex = find("type", "dr/cr");
  if (descIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) return null;
  const transactions = lines.slice(1).map((line, index) => {
    const row = split(line); const clean = (v = "") => Number(v.replace(/[^0-9.-]/g, "")) || 0; const creditAmount = creditIndex >= 0 ? clean(row[creditIndex]) : 0, debitAmount = debitIndex >= 0 ? clean(row[debitIndex]) : 0; const isCredit = creditAmount > 0 || /cr|credit|deposit/.test(typeIndex >= 0 ? row[typeIndex]?.toLowerCase() : ""); const amount = amountIndex >= 0 ? Math.abs(clean(row[amountIndex])) : (creditAmount || debitAmount); const description = row[descIndex] || "Unknown transaction";
    return { id: `import-${index + 1}`, date: row[dateIndex] || new Date().toISOString().slice(0, 10), merchant: normalizeMerchant(description), description, amount, type: isCredit ? "credit" as const : "debit" as const, category: guessCategory(description, isCredit), confidence: .72, source: filename, explanation: "Categorized locally from the statement narration. Add an OpenAI API key for GPT-5.6 classification." };
  }).filter((t) => t.amount > 0);
  if (!transactions.length) return null; const totals = summarize(inPeriod(transactions)); const top = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])[0];
  return { accountName: "Imported account", bankName: filename, period: "Imported statement", currency: "INR", transactions, insights: [`${transactions.length} transactions were normalized from ${filename}.`, top ? `${top[0]} is your largest spend category at ${money(top[1])}.` : "No debit transactions found.", `Total outflow in the latest period is ${money(totals.spend)}.`], demo: true };
}
