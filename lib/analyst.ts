import {
  budgetStatus,
  compareMonths,
  detectAnomalies,
  detectSubscriptions,
  findDuplicateTransactions,
  inPeriod,
  latestPeriod,
  money,
  monthlySummaries,
  normalizeMerchant,
  periodKey,
  summarize,
} from "./finance";
import type { Budget, Category, Transaction } from "./types";

export type AnalystTone = "neutral" | "positive" | "warning" | "critical";
export type AnalystMetric = { label: string; value: string; detail?: string; tone?: AnalystTone };
export type AnalystChartPoint = { label: string; value: number; detail?: string };
export type AnalystChart = {
  type: "bar" | "line" | "donut";
  title: string;
  subtitle?: string;
  unit: "currency" | "percent" | "count";
  data: AnalystChartPoint[];
};
export type AnalystTable = { title: string; columns: string[]; rows: string[][] };
export type AnalystInsight = { title: string; detail: string; tone: AnalystTone };
export type AnalystResponse = {
  kind: "snapshot" | "comparison" | "report" | "subscriptions" | "review";
  title: string;
  scope: string;
  directAnswer: string;
  metrics: AnalystMetric[];
  chart?: AnalystChart;
  table?: AnalystTable;
  insights: AnalystInsight[];
  followUps: string[];
};

const transferCategories = new Set<Category>(["Transfers", "Investment"]);
const chartColors = ["#16b88b", "#4f72ff", "#c7f735", "#ed8a62", "#8668d8", "#58a7a0"];

const categoryAliases: Array<[Category, RegExp]> = [
  ["Food & Dining", /\b(food|dining|restaurant|restaurants|grocery|groceries|cafe|cafes|café|coffee|swiggy|zomato|blinkit|zepto)\b/i],
  ["Housing", /\b(housing|rent|maintenance|home)\b/i],
  ["Transport", /\b(transport|commute|uber|ola|rapido|metro|fuel|petrol)\b/i],
  ["Shopping", /\b(shopping|amazon|flipkart|myntra|ajio|retail)\b/i],
  ["Bills & Utilities", /\b(bill|bills|utilities|utility|electricity|internet|broadband|water|gas)\b/i],
  ["Health", /\b(health|healthcare|medical|pharmacy|hospital|doctor|gym)\b/i],
  ["Entertainment", /\b(entertainment|streaming|movie|movies|netflix|spotify|hotstar|prime)\b/i],
  ["Travel", /\b(travel|trip|flight|flights|hotel|hotels|airline)\b/i],
  ["EMI", /\b(emi|loan|repayment)\b/i],
  ["Investment", /\b(investment|investments|sip|mutual fund|stocks?)\b/i],
  ["Transfers", /\b(transfer|transfers|p2p|person.to.person|friend|friends)\b/i],
  ["Income", /\b(income|earnings|credit|credits)\b/i],
  ["Salary", /\b(salary|payroll)\b/i],
];

function monthLabel(period: string) {
  const parsed = new Date(`${period}-01T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? period : parsed.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function percentChange(current: number, previous: number) {
  return previous ? ((current - previous) / previous) * 100 : null;
}

function changeText(current: number, previous: number) {
  const change = percentChange(current, previous);
  if (change == null) return "No prior-period baseline";
  if (Math.abs(change) < 1) return "About the same as the previous month";
  return `${Math.abs(change).toFixed(0)}% ${change > 0 ? "higher" : "lower"} than the previous month`;
}

function sum(items: Transaction[]) {
  return items.reduce((total, transaction) => total + transaction.amount, 0);
}

function sortedTotals(items: Transaction[], key: (transaction: Transaction) => string) {
  const totals = items.reduce<Record<string, { amount: number; count: number }>>((acc, transaction) => {
    const label = key(transaction);
    acc[label] ||= { amount: 0, count: 0 };
    acc[label].amount += transaction.amount;
    acc[label].count += 1;
    return acc;
  }, {});
  return Object.entries(totals).map(([label, value]) => ({ label, ...value })).sort((a, b) => b.amount - a.amount);
}

function detectCategory(question: string) {
  return categoryAliases.find(([, pattern]) => pattern.test(question))?.[0] || null;
}

function detectMerchant(question: string, transactions: Transaction[]) {
  const lower = question.toLowerCase();
  return [...new Set(transactions.map((transaction) => normalizeMerchant(transaction.merchant || transaction.description)))]
    .filter((merchant) => merchant.length >= 3 && lower.includes(merchant.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0] || null;
}

function maxLedgerDate(transactions: Transaction[]) {
  return transactions.map((transaction) => new Date(transaction.date)).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => b.getTime() - a.getTime())[0] || new Date();
}

function scopedTransactions(question: string, transactions: Transaction[]) {
  const lower = question.toLowerCase();
  const periods = [...new Set(transactions.map((transaction) => periodKey(transaction.date)))].sort();
  const latest = latestPeriod(transactions);
  const latestIndex = periods.indexOf(latest);
  const explicitYear = lower.match(/\b(20\d{2})\b/)?.[1];
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthIndex = monthNames.findIndex((month) => lower.includes(month));

  if (/\b(all time|overall|ever|every transaction|entire ledger)\b/.test(lower)) return { items: transactions, label: "All imported transactions", period: "all" };
  const rollingMonths = lower.match(/\b(?:last|past|in|over|across)\s+(\d{1,2})\s+months?\b/);
  if (rollingMonths) {
    const count = Math.max(1, Math.min(24, Number(rollingMonths[1])));
    const selected = periods.slice(-count);
    const first = selected[0], last = selected.at(-1);
    return { items: transactions.filter((transaction) => selected.includes(periodKey(transaction.date))), label: first && last ? `${monthLabel(first)} â€“ ${monthLabel(last)}` : `Last ${count} months`, period: "rolling" };
  }
  if (/\b(this year|year to date|ytd|last year)\b/.test(lower) || explicitYear) {
    const ledgerYear = Number(latest.slice(0, 4));
    const year = explicitYear ? Number(explicitYear) : /last year/.test(lower) ? ledgerYear - 1 : ledgerYear;
    return { items: transactions.filter((transaction) => periodKey(transaction.date).startsWith(String(year))), label: String(year), period: String(year) };
  }
  if (/\b(last 7 days|past 7 days|this week|last week)\b/.test(lower)) {
    const end = maxLedgerDate(transactions);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const items = transactions.filter((transaction) => { const date = new Date(transaction.date); return date >= start && date <= end; });
    return { items, label: `${start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`, period: "week" };
  }
  if (monthIndex >= 0) {
    const year = explicitYear || latest.slice(0, 4);
    const period = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    return { items: inPeriod(transactions, period), label: monthLabel(period), period };
  }
  if (/\b(last month|previous month)\b/.test(lower)) {
    const period = periods[latestIndex - 1] || latest;
    return { items: inPeriod(transactions, period), label: monthLabel(period), period };
  }
  return { items: inPeriod(transactions, latest), label: monthLabel(latest), period: latest };
}

function foodBreakdown(transaction: Transaction) {
  const text = `${transaction.merchant} ${transaction.description}`;
  if (/coffee|cafe|café|starbucks|blue tokai/i.test(text)) return "Cafés & coffee";
  if (/blinkit|grofers|zepto|bigbasket|grocery|supermarket|reliance fresh/i.test(text)) return "Groceries";
  if (/swiggy|zomato|restaurant|food delivery|eatclub|domino|pizza|mcdonald/i.test(text)) return "Restaurants & delivery";
  return "Other food";
}

function focusBreakdown(category: Category, transaction: Transaction) {
  if (category === "Food & Dining") return foodBreakdown(transaction);
  if (category === "Travel") {
    const text = `${transaction.merchant} ${transaction.description}`;
    if (/flight|airline|indigo|vistara|air india/i.test(text)) return "Flights";
    if (/hotel|booking|airbnb|stay/i.test(text)) return "Hotels & stays";
    return "Local & other travel";
  }
  return normalizeMerchant(transaction.merchant || transaction.description);
}

function chart(title: string, type: AnalystChart["type"], unit: AnalystChart["unit"], rows: Array<{ label: string; value: number; detail?: string }>): AnalystChart | undefined {
  const data = rows.filter((row) => Number.isFinite(row.value) && row.value >= 0).slice(0, 8);
  return data.length ? { type, title, unit, data } : undefined;
}

function genericInsights(transactions: Transaction[], scoped: Transaction[], comparison = compareMonths(transactions)) {
  const insights: AnalystInsight[] = [];
  const anomalies = detectAnomalies(transactions).slice(0, 2);
  anomalies.forEach((anomaly) => insights.push({ title: anomaly.title, detail: anomaly.detail, tone: anomaly.severity === "high" ? "critical" : "warning" }));
  const debits = scoped.filter((transaction) => transaction.type === "debit");
  const largest = [...debits].sort((a, b) => b.amount - a.amount)[0];
  if (largest) insights.push({ title: "Largest outgoing", detail: `${normalizeMerchant(largest.merchant)} was ${money(largest.amount)} on ${new Date(largest.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.`, tone: "neutral" });
  if (comparison.spendChangePercent != null && Math.abs(comparison.spendChangePercent) >= 10) insights.push({ title: "Consumption changed", detail: `Consumption is ${Math.abs(comparison.spendChangePercent).toFixed(0)}% ${comparison.spendChangePercent > 0 ? "higher" : "lower"} than ${monthLabel(comparison.previous)}.`, tone: comparison.spendChangePercent > 0 ? "warning" : "positive" });
  return insights.slice(0, 3);
}

export function buildAnalystResponse(question: string, transactions: Transaction[], budgets: Budget[] = []): AnalystResponse {
  const lower = question.toLowerCase();
  const scoped = scopedTransactions(question, transactions);
  const debits = scoped.items.filter((transaction) => transaction.type === "debit");
  const consumption = debits.filter((transaction) => !transferCategories.has(transaction.category));
  const credits = scoped.items.filter((transaction) => transaction.type === "credit");
  const totals = summarize(scoped.items);
  const focusCategory = detectCategory(question);
  const focusMerchant = detectMerchant(question, transactions);
  const comparison = compareMonths(transactions, scoped.period === "all" || scoped.period === "week" || scoped.period === "rolling" || scoped.period.length === 4 ? latestPeriod(transactions) : scoped.period);

  if (/subscription|recurring/.test(lower)) {
    const subscriptions = detectSubscriptions(transactions);
    const monthly = subscriptions.reduce((total, item) => total + item.monthlyCost, 0);
    return {
      kind: "subscriptions", title: "Recurring payments", scope: "Across your imported ledger",
      directAnswer: subscriptions.length ? `${subscriptions.length} recurring payment${subscriptions.length === 1 ? "" : "s"} cost about ${money(monthly)} per month.` : "No recurring cadence is strong enough to confirm yet.",
      metrics: [
        { label: "Monthly cost", value: money(monthly), detail: `${money(monthly * 12)} annualized`, tone: monthly ? "warning" : "neutral" },
        { label: "Detected", value: String(subscriptions.length), detail: "Recurring merchants" },
      ],
      chart: chart("Monthly recurring cost", "bar", "currency", subscriptions.map((item) => ({ label: item.merchant, value: item.monthlyCost, detail: `${Math.round(item.confidence * 100)}% confidence` }))),
      table: subscriptions.length ? { title: "Subscription details", columns: ["Merchant", "Monthly", "Annual", "Next estimate"], rows: subscriptions.slice(0, 8).map((item) => [item.merchant, money(item.monthlyCost), money(item.annualCost), item.estimatedRenewalDate]) } : undefined,
      insights: subscriptions.slice(0, 2).map((item) => ({ title: `${item.merchant} renews regularly`, detail: `${item.occurrences} payment${item.occurrences === 1 ? "" : "s"} support this estimate.`, tone: "neutral" })),
      followUps: ["Which subscriptions increased?", "Show recurring payments by annual cost", "What can I cancel to save money?"],
    };
  }

  if (/duplicate|charged.*twice/.test(lower)) {
    const duplicates = findDuplicateTransactions(transactions);
    const exposure = duplicates.reduce((total, item) => total + item.amount, 0);
    return {
      kind: "review", title: "Duplicate payment review", scope: "Across your imported ledger",
      directAnswer: duplicates.length ? `${duplicates.length} possible duplicate pair${duplicates.length === 1 ? "" : "s"} need review, representing ${money(exposure)} in possible repeated charges.` : "No same-merchant, same-amount payments within two minutes were found.",
      metrics: [{ label: "Possible duplicates", value: String(duplicates.length), tone: duplicates.length ? "warning" : "positive" }, { label: "Review amount", value: money(exposure), detail: "Not automatically treated as fraud" }],
      table: duplicates.length ? { title: "Transactions to review", columns: ["Merchant", "Amount", "Time apart"], rows: duplicates.map((item) => [item.merchant, money(item.amount), `${item.minutesApart} min`]) } : undefined,
      insights: [{ title: duplicates.length ? "Review before acting" : "No rapid repeats detected", detail: duplicates.length ? "A repeat can be legitimate. Compare the original receipts or merchant confirmations before disputing it." : "This check requires transaction timestamps; date-only statements cannot support a two-minute duplicate test.", tone: duplicates.length ? "warning" : "neutral" }],
      followUps: ["Show my largest recent transactions", "Which merchants charged me most often?", "Find unusual transactions"],
    };
  }

  if (/budget/.test(lower)) {
    const statuses = budgetStatus(transactions, budgets, scoped.period.length === 7 ? scoped.period : latestPeriod(transactions)).sort((a, b) => b.usedPercent - a.usedPercent);
    const tightest = statuses[0];
    return {
      kind: "review", title: "Budget position", scope: scoped.label,
      directAnswer: tightest ? `${tightest.category} is your tightest budget at ${tightest.usedPercent.toFixed(0)}% used (${money(tightest.spent)} of ${money(tightest.limit)}).` : "No category budgets are configured yet.",
      metrics: [{ label: "Budgets tracked", value: String(statuses.length) }, { label: "Over limit", value: String(statuses.filter((item) => item.status === "over").length), tone: statuses.some((item) => item.status === "over") ? "critical" : "positive" }],
      chart: chart("Budget used", "bar", "percent", statuses.map((item) => ({ label: item.category, value: Math.round(item.usedPercent), detail: `${money(item.spent)} of ${money(item.limit)}` }))),
      table: statuses.length ? { title: "Category budgets", columns: ["Category", "Spent", "Limit", "Status"], rows: statuses.map((item) => [item.category, money(item.spent), money(item.limit), item.status]) } : undefined,
      insights: statuses.filter((item) => item.status !== "on-track").slice(0, 3).map((item) => ({ title: `${item.category}: ${item.status === "over" ? "over limit" : "nearing limit"}`, detail: item.remaining >= 0 ? `${money(item.remaining)} remains.` : `${money(Math.abs(item.remaining))} over budget.`, tone: item.status === "over" ? "critical" : "warning" })),
      followUps: ["Where can I reduce spending?", "Compare my budgets with last month", "Show spending by category"],
    };
  }

  if (/anomal|unusual|surprise|spike|jump/.test(lower)) {
    const anomalies = detectAnomalies(transactions);
    return {
      kind: "review", title: "Unusual activity", scope: monthLabel(latestPeriod(transactions)),
      directAnswer: anomalies.length ? `${anomalies.length} unusual pattern${anomalies.length === 1 ? "" : "s"} stand out in the latest period.` : "No material category jumps or new high-value merchants stand out in the latest period.",
      metrics: [{ label: "Signals", value: String(anomalies.length), tone: anomalies.length ? "warning" : "positive" }, { label: "High priority", value: String(anomalies.filter((item) => item.severity === "high").length), tone: anomalies.some((item) => item.severity === "high") ? "critical" : "neutral" }],
      table: anomalies.length ? { title: "Signals to review", columns: ["Signal", "Why it matters", "Priority"], rows: anomalies.map((item) => [item.title, item.detail, item.severity]) } : undefined,
      insights: anomalies.map((item) => ({ title: item.title, detail: item.detail, tone: item.severity === "high" ? "critical" : "warning" })).slice(0, 3),
      followUps: ["What changed most from last month?", "Show my largest transactions", "Find possible duplicate payments"],
    };
  }

  if (focusCategory) {
    const creditFocus = focusCategory === "Income" || focusCategory === "Salary";
    const focused = scoped.items.filter((transaction) => transaction.type === (creditFocus ? "credit" : "debit") && transaction.category === focusCategory);
    const amount = sum(focused);
    const previousItems = inPeriod(transactions, comparison.previous).filter((transaction) => transaction.type === (creditFocus ? "credit" : "debit") && transaction.category === focusCategory);
    const previousAmount = sum(previousItems);
    const shareBase = creditFocus ? sum(credits) : totals.spend;
    const share = shareBase ? amount / shareBase * 100 : 0;
    const merchants = sortedTotals(focused, (transaction) => normalizeMerchant(transaction.merchant || transaction.description));
    const breakdown = sortedTotals(focused, (transaction) => focusBreakdown(focusCategory, transaction));
    const trend = [...new Set(transactions.map((transaction) => periodKey(transaction.date)))].sort().slice(-6).map((period) => ({ label: monthLabel(period), value: sum(inPeriod(transactions, period).filter((transaction) => transaction.type === (creditFocus ? "credit" : "debit") && transaction.category === focusCategory)) }));
    const largest = merchants[0];
    const change = percentChange(amount, previousAmount);
    const insights: AnalystInsight[] = [];
    if (change != null && Math.abs(change) >= 10) insights.push({ title: `${focusCategory} moved ${Math.abs(change).toFixed(0)}%`, detail: `${money(amount)} in ${scoped.label} versus ${money(previousAmount)} in ${monthLabel(comparison.previous)}.`, tone: change > 0 ? "warning" : "positive" });
    if (largest) insights.push({ title: `${largest.label} led the category`, detail: `${money(largest.amount)} across ${largest.count} payment${largest.count === 1 ? "" : "s"}.`, tone: "neutral" });
    if (["Food & Dining", "Shopping", "Entertainment", "Travel"].includes(focusCategory) && amount > 0) insights.push({ title: "A practical sensitivity check", detail: `A 10% reduction in this category would retain about ${money(amount * .1)} in a similar month, if that fits your priorities.`, tone: "neutral" });
    const relatedAnomaly = detectAnomalies(transactions).find((item) => item.title.toLowerCase().includes(focusCategory.toLowerCase()));
    if (relatedAnomaly) insights.push({ title: relatedAnomaly.title, detail: relatedAnomaly.detail, tone: relatedAnomaly.severity === "high" ? "critical" : "warning" });
    return {
      kind: /report|review|analysis|summary/.test(lower) ? "report" : "snapshot",
      title: `${focusCategory} analysis`, scope: scoped.label,
      directAnswer: `You ${creditFocus ? "received" : "spent"} ${money(amount)} ${creditFocus ? "as" : "on"} ${focusCategory} in ${scoped.label}, across ${focused.length} transaction${focused.length === 1 ? "" : "s"}.`,
      metrics: [
        { label: focusCategory, value: money(amount), detail: `${focused.length} payments` },
        { label: creditFocus ? "Share of income" : "Share of consumption", value: `${share.toFixed(1)}%`, detail: `${money(shareBase)} total ${creditFocus ? "income" : "consumption"}` },
        { label: "Previous month", value: money(previousAmount), detail: changeText(amount, previousAmount), tone: change != null && change > 15 ? "warning" : change != null && change < -15 ? "positive" : "neutral" },
        { label: "Top merchant", value: largest?.label || "None", detail: largest ? money(largest.amount) : "No matching transactions" },
      ],
      chart: chart(trend.some((item) => item.value > 0) && trend.length > 1 ? `${focusCategory} over time` : `${focusCategory} breakdown`, trend.length > 1 ? "line" : "bar", "currency", trend.length > 1 ? trend : breakdown.map((item) => ({ label: item.label, value: item.amount, detail: `${item.count} payments` }))),
      table: breakdown.length ? { title: "Where it went", columns: ["Breakdown", "Spent", "Payments", "Share", "Top merchant"], rows: breakdown.slice(0, 7).map((item) => {
        const group = focused.filter((transaction) => focusBreakdown(focusCategory, transaction) === item.label);
        const topMerchant = sortedTotals(group, (transaction) => normalizeMerchant(transaction.merchant || transaction.description))[0];
        return [item.label, money(item.amount), String(item.count), `${amount ? (item.amount / amount * 100).toFixed(1) : "0"}%`, topMerchant?.label || "None"];
      }) } : undefined,
      insights: insights.length ? insights : [{ title: "No unusual movement", detail: previousAmount ? changeText(amount, previousAmount) : "Import another month to establish a comparison baseline.", tone: "neutral" }],
      followUps: [`Show every ${focusCategory.toLowerCase()} transaction`, `Which ${focusCategory.toLowerCase()} merchant cost the most?`, `Compare ${focusCategory.toLowerCase()} month by month`],
    };
  }

  if (focusMerchant) {
    const merchantItems = scoped.items.filter((transaction) => normalizeMerchant(transaction.merchant || transaction.description) === focusMerchant);
    const outgoing = merchantItems.filter((transaction) => transaction.type === "debit");
    const total = sum(outgoing);
    const trend = [...new Set(transactions.map((transaction) => periodKey(transaction.date)))].sort().slice(-6).map((period) => ({ label: monthLabel(period), value: sum(inPeriod(transactions, period).filter((transaction) => transaction.type === "debit" && normalizeMerchant(transaction.merchant || transaction.description) === focusMerchant)) }));
    const largest = [...outgoing].sort((a, b) => b.amount - a.amount)[0];
    return {
      kind: "snapshot", title: `${focusMerchant} activity`, scope: scoped.label,
      directAnswer: `Your ${focusMerchant} outflow was ${money(total)} in ${scoped.label}, across ${outgoing.length} payment${outgoing.length === 1 ? "" : "s"}.`,
      metrics: [{ label: "Total paid", value: money(total) }, { label: "Payments", value: String(outgoing.length) }, { label: "Average payment", value: money(total / Math.max(1, outgoing.length)) }, { label: "Largest payment", value: money(largest?.amount || 0), detail: largest?.date }],
      chart: chart(`${focusMerchant} over time`, "line", "currency", trend),
      table: outgoing.length ? { title: "Recent transactions", columns: ["Date", "Amount", "Category"], rows: [...outgoing].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((item) => [item.date.slice(0, 10), money(item.amount), item.category]) } : undefined,
      insights: genericInsights(transactions, merchantItems).slice(0, 2),
      followUps: [`Show all ${focusMerchant} transactions`, `Compare ${focusMerchant} month by month`, `Is ${focusMerchant} recurring?`],
    };
  }

  const byCategory = sortedTotals(consumption, (transaction) => transaction.category);
  const byMerchant = sortedTotals(debits, (transaction) => normalizeMerchant(transaction.merchant || transaction.description));
  const outflow = sum(debits);
  const previousOutflow = comparison.previousSummary.spend + comparison.previousSummary.transfers;
  const isComparison = /compare|versus|vs\.?|change|trend|last month|previous month/.test(lower);
  const isReport = /report|review|analysis|summary|overview/.test(lower);
  const monthly = monthlySummaries(transactions).slice(-6).map((item) => ({ label: monthLabel(item.period), value: item.spend + item.transfers, detail: `${money(item.spend)} consumption` }));
  return {
    kind: isReport ? "report" : isComparison ? "comparison" : "snapshot",
    title: isReport ? "Money review" : isComparison ? "Spending comparison" : "Financial snapshot",
    scope: scoped.label,
    directAnswer: isComparison ? `Total outflow was ${money(outflow)} in ${scoped.label}. ${changeText(outflow, previousOutflow)}.` : `Your total outflow was ${money(outflow)} in ${scoped.label}: ${money(totals.spend)} consumption and ${money(totals.transfers)} transfers or investments.`,
    metrics: [
      { label: "Total outflow", value: money(outflow), detail: `${debits.length} outgoing transactions` },
      { label: "Consumption", value: money(totals.spend), detail: outflow ? `${(totals.spend / outflow * 100).toFixed(1)}% of outflow` : "No outgoing transactions" },
      { label: "Transfers & investments", value: money(totals.transfers), detail: outflow ? `${(totals.transfers / outflow * 100).toFixed(1)}% of outflow` : "None" },
      { label: "Income", value: money(sum(credits)), detail: `${credits.length} incoming transactions`, tone: credits.length ? "positive" : "neutral" },
    ],
    chart: chart(isComparison || monthly.length > 1 ? "Outflow over time" : "Consumption by category", isComparison || monthly.length > 1 ? "line" : "donut", "currency", isComparison || monthly.length > 1 ? monthly : byCategory.map((item) => ({ label: item.label, value: item.amount, detail: `${item.count} payments` }))),
    table: (isReport ? byCategory : byMerchant).length ? { title: isReport ? "Category breakdown" : "Top merchants", columns: [isReport ? "Category" : "Merchant", "Amount", "Transactions", "Share"], rows: (isReport ? byCategory : byMerchant).slice(0, 8).map((item) => [item.label, money(item.amount), String(item.count), `${outflow ? (item.amount / outflow * 100).toFixed(1) : "0"}%`]) } : undefined,
    insights: genericInsights(transactions, scoped.items, comparison),
    followUps: ["What changed most from last month?", "Show spending by category", "Which merchants cost me the most?", "Find unusual transactions"],
  };
}

export function analystMarkdown(analysis: AnalystResponse) {
  const insights = analysis.insights.length ? `\n\n### What stands out\n${analysis.insights.map((item) => `- **${item.title}:** ${item.detail}`).join("\n")}` : "";
  return `### ${analysis.title}\n\n${analysis.directAnswer}${insights}`;
}

export function sanitizeAnalystResponse(input: unknown): AnalystResponse | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Partial<AnalystResponse>;
  if (!value.title || !value.scope || !value.directAnswer || !Array.isArray(value.metrics) || !Array.isArray(value.insights) || !Array.isArray(value.followUps)) return undefined;
  const clean = (text: unknown, length = 240) => String(text || "").slice(0, length);
  const tones = new Set<AnalystTone>(["neutral", "positive", "warning", "critical"]);
  const kinds = new Set<AnalystResponse["kind"]>(["snapshot", "comparison", "report", "subscriptions", "review"]);
  const result: AnalystResponse = {
    kind: kinds.has(value.kind as AnalystResponse["kind"]) ? value.kind as AnalystResponse["kind"] : "snapshot",
    title: clean(value.title, 100), scope: clean(value.scope, 100), directAnswer: clean(value.directAnswer, 600),
    metrics: value.metrics.slice(0, 6).map((item) => ({ label: clean(item?.label, 80), value: clean(item?.value, 100), detail: item?.detail ? clean(item.detail, 180) : undefined, tone: tones.has(item?.tone as AnalystTone) ? item?.tone : "neutral" })),
    insights: value.insights.slice(0, 5).map((item) => ({ title: clean(item?.title, 120), detail: clean(item?.detail, 360), tone: tones.has(item?.tone as AnalystTone) ? item?.tone as AnalystTone : "neutral" })),
    followUps: value.followUps.slice(0, 5).map((item) => clean(item, 160)).filter(Boolean),
  };
  if (value.chart && ["bar", "line", "donut"].includes(value.chart.type) && ["currency", "percent", "count"].includes(value.chart.unit) && Array.isArray(value.chart.data)) result.chart = {
    type: value.chart.type, title: clean(value.chart.title, 120), subtitle: value.chart.subtitle ? clean(value.chart.subtitle, 180) : undefined, unit: value.chart.unit,
    data: value.chart.data.slice(0, 10).map((point) => ({ label: clean(point?.label, 80), value: Number(point?.value) || 0, detail: point?.detail ? clean(point.detail, 160) : undefined })),
  };
  if (value.table && Array.isArray(value.table.columns) && Array.isArray(value.table.rows)) result.table = {
    title: clean(value.table.title, 120), columns: value.table.columns.slice(0, 6).map((column) => clean(column, 80)),
    rows: value.table.rows.slice(0, 12).map((row) => Array.isArray(row) ? row.slice(0, 6).map((cell) => clean(cell, 180)) : []),
  };
  return result;
}

export { chartColors };
