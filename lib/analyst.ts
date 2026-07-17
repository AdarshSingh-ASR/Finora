import {
  analyzeFinances,
  buildFinancialTimeline,
  explainSpendingChange,
  financialHealthReport,
  findCostCutting,
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
  suggestBudgets,
  summarize,
} from "./finance";
import type { Budget, Category, FinancialTimelineEvent, MonthEndForecast, Transaction } from "./types";

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
  forecast?: MonthEndForecast;
  timeline?: FinancialTimelineEvent[];
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

  const asksForTransactionCount = /\b(?:how many|number of|count(?: of)?|total)\s+(?:saved\s+|imported\s+)?(?:transactions?|payments?)\b|\btransaction count\b/.test(lower);
  if (asksForTransactionCount) {
    const hasExplicitPeriod = /\b(?:this month|last month|previous month|this week|last week|last \d+ days|past \d+ days|last \d+ months?|past \d+ months?|this year|last year|year to date|ytd|20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(lower);
    let countItems = hasExplicitPeriod ? scoped.items : transactions;
    const countScope = hasExplicitPeriod ? scoped.label : "your imported ledger";
    let qualifier = "";

    if (focusMerchant) {
      countItems = countItems.filter((transaction) => normalizeMerchant(transaction.merchant || transaction.description) === focusMerchant);
      qualifier = `${focusMerchant} `;
    } else if (focusCategory) {
      countItems = countItems.filter((transaction) => transaction.category === focusCategory);
      qualifier = `${focusCategory.toLowerCase()} `;
    }

    if (/\b(?:incoming|received|credit|credits)\b/.test(lower)) {
      countItems = countItems.filter((transaction) => transaction.type === "credit");
      qualifier = `incoming ${qualifier}`;
    } else if (/\b(?:outgoing|sent|debit|debits)\b/.test(lower)) {
      countItems = countItems.filter((transaction) => transaction.type === "debit");
      qualifier = `outgoing ${qualifier}`;
    }

    const count = countItems.length;
    return {
      kind: "snapshot",
      title: "Transaction count",
      scope: countScope,
      directAnswer: count
        ? `You have ${count.toLocaleString("en-IN")} ${qualifier}transaction${count === 1 ? "" : "s"} in ${countScope}.`
        : `You have no ${qualifier}transactions in ${countScope}.`,
      metrics: [],
      insights: [],
      followUps: [],
    };
  }

  const asksForSimpleIncome = !focusCategory && !focusMerchant && /\b(?:how much|what(?:'s| is)|total)\b.*\b(?:income|received|earned)\b/.test(lower);
  const asksForSimpleOutflow = !focusCategory && !focusMerchant && /\b(?:how much|what(?:'s| is)|total)\b.*\b(?:spend|spent|spending|outflow|sent)\b/.test(lower);
  const asksForAnalysis = /\b(?:compare|comparison|trend|breakdown|change|changed|why|report|analysis|analy[sz]e|forecast|predict|projection|timeline|chart|graph|unusual|anomal|budget|subscription|recurring)\b/.test(lower);
  if (!asksForAnalysis && (asksForSimpleIncome || asksForSimpleOutflow)) {
    return {
      kind: "snapshot",
      title: asksForSimpleIncome ? "Income total" : "Outflow total",
      scope: scoped.label,
      directAnswer: asksForSimpleIncome
        ? `You received ${money(totals.income)} across ${credits.length.toLocaleString("en-IN")} incoming transaction${credits.length === 1 ? "" : "s"} in ${scoped.label}.`
        : `Your total outflow was ${money(totals.totalOutflow)} in ${scoped.label}: ${money(totals.consumption)} in consumption and ${money(totals.transfers)} in transfers and investments.`,
      metrics: [],
      insights: [],
      followUps: [],
    };
  }

  if (/timeline|what happened|last six months|last 6 months|money story/.test(lower)) {
    const intelligence = analyzeFinances(transactions, budgets);
    const timeline = buildFinancialTimeline(transactions, budgets, 6);
    const monthly = monthlySummaries(transactions).slice(-6);
    return {
      kind: "report", title: "Your financial timeline", scope: monthly.length ? `${monthLabel(monthly[0].period)} to ${monthLabel(monthly.at(-1)!.period)}` : "Imported ledger",
      directAnswer: timeline.length ? `${timeline.length} material change${timeline.length === 1 ? "" : "s"} tell the story of your last ${Math.min(6, monthly.length)} imported month${monthly.length === 1 ? "" : "s"}.` : "There is not enough month-to-month movement to build a meaningful timeline yet.",
      metrics: [
        { label: "Latest consumption", value: money(intelligence.cashFlow.consumption), detail: intelligence.period },
        { label: "Net cash flow", value: money(intelligence.cashFlow.netCashFlow), tone: intelligence.cashFlow.netCashFlow >= 0 ? "positive" : "warning" },
        { label: "Savings rate", value: `${intelligence.cashFlow.savingsRate.toFixed(1)}%`, detail: "Income less consumption" },
        { label: "Timeline events", value: String(timeline.length), detail: "Material, evidence-linked changes" },
      ],
      chart: chart("Outflow across the timeline", "line", "currency", monthly.map((item) => ({ label: monthLabel(item.period), value: item.spend + item.transfers, detail: `${money(item.spend)} consumption` }))),
      insights: timeline.slice(-4).reverse().map((item) => ({ title: item.title, detail: item.detail, tone: item.significance === "high" ? "warning" : "neutral" })),
      timeline,
      followUps: ["What changed most from last month?", "Which categories drove the biggest changes?", "Which new recurring payments appeared?"],
    };
  }

  if (/forecast|predict|projection|month.?end/.test(lower)) {
    const intelligence = analyzeFinances(transactions, budgets, scoped.period.length === 7 ? scoped.period : undefined);
    const forecast = intelligence.forecast;
    return {
      kind: "report", title: "Month-end forecast", scope: forecast.period,
      directAnswer: `Finora projects ${money(forecast.projectedConsumption)} in consumption by month end, with ${forecast.confidence} confidence.`,
      metrics: [
        { label: "Spent so far", value: money(forecast.actualConsumption), detail: `Through ${forecast.asOfDate}` },
        { label: "Projected consumption", value: money(forecast.projectedConsumption), tone: forecast.projectedConsumption > forecast.actualConsumption * 1.25 ? "warning" : "neutral" },
        { label: "Projected outflow", value: money(forecast.projectedTotalOutflow), detail: "Includes transfers and investments" },
        { label: "Projected cash flow", value: money(forecast.projectedNetCashFlow), tone: forecast.projectedNetCashFlow >= 0 ? "positive" : "warning" },
      ],
      chart: chart("Actual versus projected consumption", "bar", "currency", [{ label: "Actual so far", value: forecast.actualConsumption }, { label: "Month-end estimate", value: forecast.projectedConsumption }]),
      insights: [{ title: `${forecast.confidence} confidence`, detail: forecast.explanation, tone: forecast.confidence === "low" ? "warning" : "neutral" }, ...(forecast.recurringStillExpected ? [{ title: "Recurring costs still expected", detail: `${money(forecast.recurringStillExpected)} is included in the estimate.`, tone: "neutral" as const }] : [])],
      forecast,
      followUps: ["What is driving this forecast?", "Where can I reduce spending?", "Suggest category budgets", "Show my six-month timeline"],
    };
  }

  if (/find savings|save money|cost.?cut|reduce spending|where can i cut|what can i cancel/.test(lower)) {
    const findings = findCostCutting(transactions, scoped.period.length === 7 ? scoped.period : undefined);
    return {
      kind: "review", title: "Savings opportunities", scope: scoped.label,
      directAnswer: findings.opportunities.length ? `Finora found ${findings.opportunities.length} evidence-backed opportunities worth up to ${money(findings.totalMonthlyPotential)} per month if they fit your priorities.` : "No strong savings opportunity is supported by the current ledger yet.",
      metrics: [{ label: "Monthly potential", value: money(findings.totalMonthlyPotential), tone: findings.totalMonthlyPotential ? "positive" : "neutral" }, { label: "Annualized", value: money(findings.totalAnnualPotential), detail: "If the same changes continue" }, { label: "Opportunities", value: String(findings.opportunities.length) }],
      chart: chart("Potential monthly reduction", "bar", "currency", findings.opportunities.map((item) => ({ label: item.title, value: item.monthlyPotential, detail: `${Math.round(item.confidence * 100)}% confidence` }))),
      table: findings.opportunities.length ? { title: "Evidence-backed options", columns: ["Opportunity", "Monthly", "Annual", "Evidence"], rows: findings.opportunities.map((item) => [item.title, money(item.monthlyPotential), money(item.annualPotential), item.detail]) } : undefined,
      insights: findings.opportunities.slice(0, 3).map((item) => ({ title: item.title, detail: item.detail, tone: "neutral" })),
      followUps: ["Which subscriptions cost me the most?", "Suggest category budgets", "What changed most last month?", "Show discretionary spending"],
    };
  }

  if (/how much (?:did i |have i )?save|how much.*saved|net cash flow|saving(?:s)? rate/.test(lower)) {
    const intelligence = analyzeFinances(transactions, budgets, scoped.period.length === 7 ? scoped.period : undefined);
    const months = monthlySummaries(transactions).slice(-6);
    const cashFlow = intelligence.cashFlow;
    return {
      kind: "snapshot", title: "Savings and cash flow", scope: scoped.label,
      directAnswer: cashFlow.income
        ? `Your net cash flow was ${money(cashFlow.netCashFlow)} in ${scoped.label}, with a ${cashFlow.savingsRate.toFixed(1)}% consumption savings rate.`
        : `No income was detected in ${scoped.label}, so a meaningful savings rate cannot be calculated. Net cash flow was ${money(cashFlow.netCashFlow)}.`,
      metrics: [
        { label: "Net cash flow", value: money(cashFlow.netCashFlow), tone: cashFlow.netCashFlow >= 0 ? "positive" : "warning" },
        { label: "Savings rate", value: cashFlow.income ? `${cashFlow.savingsRate.toFixed(1)}%` : "Not available", detail: "Income less consumption" },
        { label: "Income", value: money(cashFlow.income) },
        { label: "Consumption", value: money(cashFlow.consumption) },
      ],
      chart: chart("Net cash flow by month", "line", "currency", months.map((item) => ({ label: monthLabel(item.period), value: Math.max(0, item.saved), detail: `${item.savingsRate.toFixed(1)}% savings rate` }))),
      insights: cashFlow.transfers || cashFlow.investmentContributions ? [{ title: "Outflows are shown separately", detail: `${money(cashFlow.transfers)} went to transfers and ${money(cashFlow.investmentContributions)} to investments; neither is hidden from total cash flow.`, tone: "neutral" }] : [],
      followUps: ["What changed my savings rate?", "Where can I reduce spending?", "Compare my cash flow month by month"],
    };
  }

  if (/health report|financial health|savings rate|fixed vs variable|fixed and variable/.test(lower)) {
    const report = financialHealthReport(transactions, budgets, scoped.period.length === 7 ? scoped.period : undefined) as ReturnType<typeof financialHealthReport>;
    return {
      kind: "report", title: "Financial health report", scope: String(report.period),
      directAnswer: `Your financial health score is ${report.score}/100 (${report.label}). Your consumption savings rate is ${report.cashFlow.savingsRate.toFixed(1)}%.`,
      metrics: [{ label: "Health score", value: `${report.score}/100`, tone: report.score >= 65 ? "positive" : "warning" }, { label: "Net cash flow", value: money(report.cashFlow.netCashFlow), tone: report.cashFlow.netCashFlow >= 0 ? "positive" : "warning" }, { label: "Fixed costs", value: money(report.classificationTotals.fixed) }, { label: "Variable costs", value: money(report.classificationTotals.variable) }],
      chart: chart("Health score components", "bar", "count", Object.entries(report.breakdown).map(([label, value]) => ({ label, value: Number(value) }))),
      table: { title: "Spending composition", columns: ["Class", "Amount"], rows: [["Essential", money(report.classificationTotals.essential)], ["Discretionary", money(report.classificationTotals.discretionary)], ["Context-dependent", money(report.classificationTotals.neutral)], ["Subscriptions", `${report.classificationTotals.subscriptionShare.toFixed(1)}% of consumption`]] },
      insights: [...report.savingsOpportunities.slice(0, 2).map((item) => ({ title: item.title, detail: item.detail, tone: "neutral" as const })), ...report.anomalies.slice(0, 1).map((item) => ({ title: item.title, detail: item.detail, tone: item.severity === "high" ? "critical" as const : "warning" as const }))],
      followUps: ["Why is my score at this level?", "Where can I reduce spending?", "Suggest category budgets", "Show my financial timeline"],
    };
  }

  if (/what changed|why.*(?:spend|outflow)|explain.*change|drove.*change/.test(lower)) {
    const change = explainSpendingChange(transactions, scoped.period.length === 7 ? scoped.period : undefined) as ReturnType<typeof explainSpendingChange>;
    const categories = change.categoryDrivers as Array<{ category: string; current: number; previous: number; difference: number; changePercent: number | null }>;
    const merchants = change.merchantDrivers as Array<{ merchant: string; current: number; previous: number; difference: number }>;
    const changePercent = change.consumptionChangePercent as number | null;
    return {
      kind: "comparison", title: "What changed", scope: `${String(change.previous || "Prior period")} to ${String(change.current || "Latest period")}`,
      directAnswer: changePercent == null ? "There is not enough prior consumption to calculate a percentage change." : `Consumption was ${Math.abs(changePercent).toFixed(0)}% ${changePercent >= 0 ? "higher" : "lower"} than the previous period.`,
      metrics: categories.slice(0, 4).map((item) => ({ label: item.category, value: `${item.difference >= 0 ? "+" : ""}${money(item.difference)}`, detail: `${money(item.current)} now vs ${money(item.previous)}`, tone: item.difference > 0 ? "warning" : "positive" })),
      chart: chart("Largest category drivers", "bar", "currency", categories.slice(0, 8).map((item) => ({ label: item.category, value: Math.abs(item.difference), detail: `${item.difference >= 0 ? "Increase" : "Decrease"} of ${money(Math.abs(item.difference))}` }))),
      table: merchants.length ? { title: "Merchant drivers", columns: ["Merchant", "Current", "Previous", "Difference"], rows: merchants.slice(0, 8).map((item) => [item.merchant, money(item.current), money(item.previous), `${item.difference >= 0 ? "+" : ""}${money(item.difference)}`]) } : undefined,
      insights: categories.slice(0, 3).map((item) => ({ title: `${item.category} ${item.difference >= 0 ? "increased" : "decreased"}`, detail: `${money(item.current)} versus ${money(item.previous)} previously.`, tone: item.difference > 0 ? "warning" : "positive" })),
      followUps: ["Which merchants cost me the most?", "Show spending by category", "Find unusual transactions", "Predict my month-end spending"],
    };
  }

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
    if (/suggest|recommend|set|create|ideal|should.*budget/.test(lower)) {
      const suggestions = suggestBudgets(transactions, 10) as Array<{ category: string; suggestedLimit: number; baseline: number; bufferPercent: number; monthsUsed: number; confidence: string }>;
      return {
        kind: "review", title: "Suggested category budgets", scope: "Up to three completed months",
        directAnswer: suggestions.length ? `Finora built ${suggestions.length} category limit${suggestions.length === 1 ? "" : "s"} from your trailing median spending with a 10% buffer.` : "There is not enough consumption history to suggest a budget yet.",
        metrics: [{ label: "Categories", value: String(suggestions.length) }, { label: "Suggested total", value: money(suggestions.reduce((total, item) => total + item.suggestedLimit, 0)) }, { label: "History used", value: `${Math.max(0, ...suggestions.map((item) => item.monthsUsed))} months` }],
        chart: chart("Suggested monthly limits", "bar", "currency", suggestions.map((item) => ({ label: item.category, value: item.suggestedLimit, detail: `${money(item.baseline)} median + ${item.bufferPercent}% buffer` }))),
        table: suggestions.length ? { title: "Evidence-based limits", columns: ["Category", "Suggested", "Median", "Confidence"], rows: suggestions.map((item) => [item.category, money(item.suggestedLimit), money(item.baseline), item.confidence]) } : undefined,
        insights: suggestions.slice(0, 3).map((item) => ({ title: `${item.category}: ${money(item.suggestedLimit)}`, detail: `Based on a ${money(item.baseline)} trailing median across ${item.monthsUsed} month${item.monthsUsed === 1 ? "" : "s"}.`, tone: item.confidence === "low" ? "warning" : "neutral" })),
        followUps: ["Which budget is most likely to be exceeded?", "Where can I reduce spending?", "Compare spending by category"],
      };
    }
    const statuses = budgetStatus(transactions, budgets, scoped.period.length === 7 ? scoped.period : latestPeriod(transactions)).sort((a, b) => b.usedPercent - a.usedPercent);
    const compareBudget = /compare|last month|previous month|trend/.test(lower);
    const previousStatuses = new Map(budgetStatus(transactions, budgets, comparison.previous).map((item) => [item.category, item]));
    const tightest = statuses[0];
    return {
      kind: "review", title: "Budget position", scope: scoped.label,
      directAnswer: tightest ? `${tightest.category} is your tightest budget at ${tightest.usedPercent.toFixed(0)}% used (${money(tightest.spent)} of ${money(tightest.limit)}).` : "No category budgets are configured yet.",
      metrics: [{ label: "Budgets tracked", value: String(statuses.length) }, { label: "Over limit", value: String(statuses.filter((item) => item.status === "over").length), tone: statuses.some((item) => item.status === "over") ? "critical" : "positive" }],
      chart: chart("Budget used", "bar", "percent", statuses.map((item) => ({ label: item.category, value: Math.round(item.usedPercent), detail: `${money(item.spent)} of ${money(item.limit)}` }))),
      table: statuses.length ? compareBudget
        ? { title: "Budget comparison", columns: ["Category", "Current", "Previous", "Change", "Limit"], rows: statuses.map((item) => { const previous = previousStatuses.get(item.category); return [item.category, money(item.spent), money(previous?.spent || 0), `${item.spent - (previous?.spent || 0) >= 0 ? "+" : ""}${money(item.spent - (previous?.spent || 0))}`, money(item.limit)]; }) }
        : { title: "Category budgets", columns: ["Category", "Spent", "Limit", "Status"], rows: statuses.map((item) => [item.category, money(item.spent), money(item.limit), item.status]) } : undefined,
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

  if (/which merchants?|top merchants?|merchant breakdown|merchants? cost|spent.*merchants?/.test(lower)) {
    const merchantTotals = sortedTotals(debits, (transaction) => normalizeMerchant(transaction.merchant || transaction.description));
    const outflow = sum(debits);
    const top = merchantTotals[0];
    return {
      kind: "snapshot", title: "Merchant breakdown", scope: scoped.label,
      directAnswer: top ? `${top.label} received the most money in ${scoped.label}: ${money(top.amount)} across ${top.count} transaction${top.count === 1 ? "" : "s"}.` : `No outgoing merchant payments were found in ${scoped.label}.`,
      metrics: [
        { label: "Top merchant", value: top?.label || "None", detail: top ? money(top.amount) : undefined },
        { label: "Merchants paid", value: String(merchantTotals.length) },
        { label: "Total outflow", value: money(outflow) },
        { label: "Top merchant share", value: `${outflow && top ? (top.amount / outflow * 100).toFixed(1) : "0"}%` },
      ],
      chart: chart("Outflow by merchant", "bar", "currency", merchantTotals.map((item) => ({ label: item.label, value: item.amount, detail: `${item.count} transactions` }))),
      table: merchantTotals.length ? { title: "Merchant ranking", columns: ["Merchant", "Amount", "Transactions", "Share"], rows: merchantTotals.slice(0, 10).map((item) => [item.label, money(item.amount), String(item.count), `${outflow ? (item.amount / outflow * 100).toFixed(1) : "0"}%`]) } : undefined,
      insights: top ? [{ title: `${top.label} led your outflow`, detail: `${money(top.amount)} represents ${outflow ? (top.amount / outflow * 100).toFixed(1) : "0"}% of all outgoing money in this scope.`, tone: "neutral" }] : [],
      followUps: top ? [`Show all ${top.label} transactions`, `Is ${top.label} recurring?`, "Compare top merchants month by month"] : ["Show spending by category"],
    };
  }

  const byCategory = sortedTotals(consumption, (transaction) => transaction.category);
  const byMerchant = sortedTotals(debits, (transaction) => normalizeMerchant(transaction.merchant || transaction.description));
  const outflow = sum(debits);
  const previousOutflow = comparison.previousSummary.spend + comparison.previousSummary.transfers;
  const isComparison = /compare|versus|vs\.?|change|trend|last month|previous month/.test(lower);
  const isReport = /report|review|analysis|summary|overview/.test(lower);
  const monthly = monthlySummaries(transactions).slice(-6).map((item) => ({ label: monthLabel(item.period), value: item.spend + item.transfers, detail: `${money(item.spend)} consumption` }));
  const wantsTrend = /trend|over time|month by month|compare|versus|vs\.?|change|last month|previous month/.test(lower);
  const visualRows = wantsTrend ? monthly : byCategory.map((item) => ({ label: item.label, value: item.amount, detail: `${item.count} payments` }));
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
    chart: chart(wantsTrend ? "Outflow over time" : "Consumption by category", wantsTrend ? "line" : "donut", "currency", visualRows),
    table: (isReport ? byCategory : byMerchant).length ? { title: isReport ? "Category breakdown" : "Top merchants", columns: [isReport ? "Category" : "Merchant", "Amount", "Transactions", "Share"], rows: (isReport ? byCategory : byMerchant).slice(0, 8).map((item) => [item.label, money(item.amount), String(item.count), `${outflow ? (item.amount / outflow * 100).toFixed(1) : "0"}%`]) } : undefined,
    insights: genericInsights(transactions, scoped.items, comparison),
    followUps: isComparison ? ["What caused the biggest change?", "Compare categories month by month", "Which merchants changed most?"] : ["What changed most from last month?", "Which merchants cost me the most?", "Find unusual transactions"],
  };
}

export function analystMarkdown(analysis: AnalystResponse) {
  const insights = analysis.insights.length ? `\n\n### What stands out\n${analysis.insights.map((item) => `- **${item.title}:** ${item.detail}`).join("\n")}` : "";
  return `### ${analysis.title}\n\n${analysis.directAnswer}${insights}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

/** Render only Finora's validated analyst contract; model-authored HTML is never accepted. */
export function analystHtml(analysis: AnalystResponse) {
  const metrics = analysis.metrics.map((item) => `<article><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.detail || "")}</p></article>`).join("");
  const insights = analysis.insights.map((item) => `<li class="${escapeHtml(item.tone)}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></li>`).join("");
  const table = analysis.table ? `<section><h2>${escapeHtml(analysis.table.title)}</h2><table><thead><tr>${analysis.table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${analysis.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>` : "";
  const timeline = analysis.timeline?.length ? `<section><h2>Financial timeline</h2><ol class="timeline">${analysis.timeline.map((event) => `<li><time>${escapeHtml(event.period)}</time><div><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.detail)}</p></div></li>`).join("")}</ol></section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(analysis.title)} · Finora</title><style>body{margin:0;background:#f6faf7;color:#0b2b21;font:15px/1.55 Inter,system-ui,sans-serif}.page{max-width:1080px;margin:auto;padding:56px 28px}header{background:#0c392d;color:#fff;padding:34px;border-radius:22px}header small{letter-spacing:.16em;text-transform:uppercase;color:#58d7b2}h1{font-size:42px;margin:8px 0}header p{max-width:760px;font-size:18px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:18px 0}.metrics article,section{background:#fff;border:1px solid #b9ddcf;border-radius:18px;padding:22px}.metrics small{display:block;text-transform:uppercase;letter-spacing:.1em;color:#547268}.metrics strong{display:block;font-size:28px;margin:8px 0}.metrics p{margin:0;color:#62776f}.insights{list-style:none;padding:0;display:grid;gap:10px}.insights li{display:grid;gap:3px;padding:14px 16px;background:#eef8f4;border-radius:12px}.insights li.warning{border-left:4px solid #ed8a62}h2{font-size:22px}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #dcebe5;padding:11px}.timeline{list-style:none;padding:0}.timeline li{display:grid;grid-template-columns:110px 1fr;gap:18px;padding:12px 0;border-bottom:1px solid #dcebe5}.timeline p{margin:4px 0;color:#62776f}footer{margin-top:24px;color:#62776f;font-size:12px}@media(max-width:600px){h1{font-size:32px}.page{padding:24px 14px}.timeline li{grid-template-columns:1fr}}</style></head><body><main class="page"><header><small>Finora analyst brief · ${escapeHtml(analysis.scope)}</small><h1>${escapeHtml(analysis.title)}</h1><p>${escapeHtml(analysis.directAnswer)}</p></header><div class="metrics">${metrics}</div><section><h2>What Finora noticed</h2><ul class="insights">${insights || "<li>No material exceptions were found.</li>"}</ul></section>${table}${timeline}<footer>Generated from your Finora ledger. Verify important financial decisions.</footer></main></body></html>`;
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
  if (value.forecast && typeof value.forecast === "object") result.forecast = value.forecast;
  if (Array.isArray(value.timeline)) result.timeline = value.timeline.slice(0, 12).map((item) => ({
    id: clean(item?.id, 120), period: clean(item?.period, 20),
    type: item?.type || "spending_change", title: clean(item?.title, 140), detail: clean(item?.detail, 360),
    ...(Number.isFinite(Number(item?.amount)) ? { amount: Number(item?.amount) } : {}),
    ...(Number.isFinite(Number(item?.changePercent)) ? { changePercent: Number(item?.changePercent) } : {}),
    significance: item?.significance === "high" ? "high" : "medium",
    evidenceTransactionIds: Array.isArray(item?.evidenceTransactionIds) ? item.evidenceTransactionIds.slice(0, 30).map((id) => clean(id, 120)) : [],
  }));
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
