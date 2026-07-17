import { normalizeMerchantName, refineTransactionsForAnalysis } from "./transaction-classifier.mjs";

const TRANSFER = "Transfers";
const INVESTMENT = "Investment";
const consumptionCategories = new Set(["Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities", "Education", "Insurance", "Personal Care", "Taxes & Fees", "Gifts & Donations", "EMI", "Health", "Entertainment", "Travel", "Miscellaneous", "Other"]);

const periodKey = (date = "") => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? String(date).slice(0, 7) : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
};
const latestPeriod = (transactions) => [...new Set(transactions.map((item) => periodKey(item.date)).filter(Boolean))].sort().at(-1) || "";
const inPeriod = (transactions, period) => transactions.filter((item) => periodKey(item.date) === period);
const sum = (items) => items.reduce((total, item) => total + (Number(item.amount) || 0), 0);
const merchantName = (item) => normalizeMerchantName(item.merchant || item.description || "Unknown merchant");
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentageChange = (current, previous) => previous ? ((current - previous) / previous) * 100 : null;
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "unknown";

function subscriptionRows(transactions) {
  transactions = refineTransactionsForAnalysis(transactions);
  const groups = transactions.filter((item) => item.type === "debit" && ![TRANSFER, INVESTMENT].includes(item.category)).reduce((acc, item) => {
    (acc[merchantName(item)] ||= []).push(item);
    return acc;
  }, {});
  const known = /Netflix|Spotify|ChatGPT|Claude|Prime|Google One|Apple|Canva|Hotstar|Jio|Airtel/i;
  return Object.entries(groups).flatMap(([merchant, values]) => {
    const items = [...values].sort((a, b) => new Date(a.date) - new Date(b.date));
    const average = sum(items) / Math.max(1, items.length);
    const stable = items.every((item) => Math.abs(item.amount - average) / Math.max(average, 1) <= .15);
    const intervals = items.slice(1).map((item, index) => (new Date(item.date) - new Date(items[index].date)) / 86400000);
    const cadence = intervals.some((days) => days >= 24 && days <= 38);
    if (!(items.length >= 2 && stable && cadence) && !(known.test(merchant) && items.length)) return [];
    const renewal = new Date(items.at(-1).date); renewal.setDate(renewal.getDate() + 30);
    return [{ merchant, monthlyCost: Math.round(average), annualCost: Math.round(average * 12), occurrences: items.length, estimatedRenewalDate: renewal.toISOString().slice(0, 10), confidence: cadence ? .94 : .72, transactionIds: items.map((item) => item.id) }];
  }).sort((a, b) => b.monthlyCost - a.monthlyCost);
}

function anomalyRows(transactions) {
  const current = latestPeriod(transactions);
  const earlier = new Set(transactions.filter((item) => periodKey(item.date) !== current).map(merchantName));
  return inPeriod(transactions, current).filter((item) => item.type === "debit" && item.amount >= 4999 && !earlier.has(merchantName(item))).slice(0, 4).map((item) => ({ id: `new-${item.id}`, severity: item.amount >= 10000 ? "high" : "medium", title: `New high-value merchant: ${merchantName(item)}`, detail: `${merchantName(item)} received ${item.amount} and did not appear in earlier imported periods.`, transactionId: item.id }));
}

function subcategoryFor(item) {
  const text = `${item.merchant || ""} ${item.description || ""}`.toLowerCase();
  if (item.category === "Food & Dining") {
    if (/blinkit|zepto|grocery|supermarket|fresh/.test(text)) return "Groceries";
    if (/coffee|cafe|starbucks|blue tokai/.test(text)) return "Cafes";
    if (/swiggy|zomato|restaurant|dining/.test(text)) return "Restaurants & delivery";
  }
  if (item.category === "Transport" && /fuel|petrol|diesel/.test(text)) return "Fuel";
  if (item.category === "Transport" && /uber|ola|rapido|taxi/.test(text)) return "Ride hailing";
  if (item.category === "Bills & Utilities" && /electric|power|bescom|cesc/.test(text)) return "Electricity";
  if (item.category === "Bills & Utilities" && /airtel|jio|broadband|internet/.test(text)) return "Connectivity";
  return item.category || "Other";
}

export function classifyTransaction(transaction, recurringMerchantNames = new Set()) {
  const recurring = recurringMerchantNames.has(merchantName(transaction));
  const fixedCategory = ["Housing", "EMI", "Bills & Utilities"].includes(transaction.category);
  const essentialCategory = ["Housing", "EMI", "Bills & Utilities", "Health"].includes(transaction.category);
  const discretionaryCategory = ["Shopping", "Entertainment", "Travel"].includes(transaction.category);
  const spendClass = recurring || fixedCategory ? "fixed" : "variable";
  const necessity = essentialCategory ? "essential" : discretionaryCategory ? "discretionary" : "neutral";
  return {
    transactionId: transaction.id,
    spendClass,
    necessity,
    subcategory: subcategoryFor(transaction),
    confidence: recurring || fixedCategory || essentialCategory || discretionaryCategory ? .88 : .68,
    explanation: recurring ? "Recurring merchant cadence makes this a fixed cost." : fixedCategory ? `${transaction.category} is treated as a fixed commitment.` : `${transaction.category} is treated as ${necessity === "neutral" ? "context-dependent" : necessity}.`,
  };
}

export function buildCashFlow(transactions, requestedPeriod) {
  transactions = refineTransactionsForAnalysis(transactions);
  const period = requestedPeriod || latestPeriod(transactions);
  const items = period ? inPeriod(transactions, period) : transactions;
  const income = sum(items.filter((item) => item.type === "credit" && ![TRANSFER, INVESTMENT].includes(item.category)));
  const consumption = sum(items.filter((item) => item.type === "debit" && consumptionCategories.has(item.category)));
  const transfers = sum(items.filter((item) => item.type === "debit" && item.category === TRANSFER));
  const investmentContributions = sum(items.filter((item) => item.type === "debit" && item.category === INVESTMENT));
  const totalOutflow = consumption + transfers + investmentContributions;
  const netCashFlow = income - totalOutflow;
  return { period, income, consumption, transfers, investmentContributions, totalOutflow, netCashFlow, savingsRate: income ? ((income - consumption) / income) * 100 : 0, transactionCount: items.length };
}

function grouped(items, keyFor) {
  return Object.values(items.reduce((acc, item) => {
    const key = keyFor(item);
    acc[key] ||= { label: key, amount: 0, count: 0, ids: [] };
    acc[key].amount += item.amount;
    acc[key].count += 1;
    acc[key].ids.push(item.id);
    return acc;
  }, {})).sort((a, b) => b.amount - a.amount);
}

export function findSavingsOpportunities(transactions, requestedPeriod) {
  transactions = refineTransactionsForAnalysis(transactions);
  const period = requestedPeriod || latestPeriod(transactions);
  const current = inPeriod(transactions, period).filter((item) => item.type === "debit" && consumptionCategories.has(item.category));
  const periods = [...new Set(transactions.map((item) => periodKey(item.date)))].sort();
  const currentIndex = periods.indexOf(period);
  const historyPeriods = periods.slice(Math.max(0, currentIndex - 3), currentIndex);
  const opportunities = subscriptionRows(transactions).slice(0, 4).map((item) => ({ id: `subscription-${slug(item.merchant)}`, kind: "subscription", title: `Review ${item.merchant}`, detail: `${item.occurrences} recurring payment${item.occurrences === 1 ? "" : "s"} imply about ${item.monthlyCost} per month.`, monthlyPotential: item.monthlyCost, annualPotential: item.annualCost, confidence: item.confidence, evidenceTransactionIds: item.transactionIds }));
  for (const row of grouped(current, (item) => item.category)) {
    const baseline = median(historyPeriods.map((historyPeriod) => sum(inPeriod(transactions, historyPeriod).filter((item) => item.type === "debit" && item.category === row.label))));
    if (baseline > 0 && row.amount - baseline >= 500 && row.amount >= baseline * 1.15) {
      const potential = Math.round(Math.min(row.amount - baseline, row.amount * .15));
      opportunities.push({ id: `category-${slug(row.label)}`, kind: "category_change", title: `${row.label} is above its recent baseline`, detail: `${row.amount.toFixed(0)} this period versus a ${baseline.toFixed(0)} trailing median.`, monthlyPotential: potential, annualPotential: potential * 12, confidence: historyPeriods.length >= 3 ? .9 : .74, evidenceTransactionIds: row.ids });
    }
  }
  return opportunities.sort((a, b) => b.monthlyPotential - a.monthlyPotential).slice(0, 6);
}

export function predictMonthEndSpending(transactions, requestedPeriod) {
  transactions = refineTransactionsForAnalysis(transactions);
  const period = requestedPeriod || latestPeriod(transactions);
  const items = inPeriod(transactions, period);
  const dates = items.map((item) => new Date(item.date)).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => a - b);
  const asOf = dates.at(-1) || new Date(`${period || new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
  const elapsedDays = Math.max(1, asOf.getUTCDate());
  const year = Number(period.slice(0, 4)) || asOf.getUTCFullYear();
  const month = Number(period.slice(5, 7)) || asOf.getUTCMonth() + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cashFlow = buildCashFlow(transactions, period);
  const subscriptions = subscriptionRows(transactions);
  const paidRecurring = new Set(items.map(merchantName));
  const recurringStillExpected = sum(subscriptions.filter((item) => !paidRecurring.has(item.merchant)).map((item) => ({ amount: item.monthlyCost })));
  const runRate = cashFlow.consumption / elapsedDays * daysInMonth;
  const projectedConsumption = Math.round(Math.max(cashFlow.consumption, runRate + recurringStillExpected));
  const projectedTotalOutflow = projectedConsumption + cashFlow.transfers + cashFlow.investmentContributions;
  const historyCount = [...new Set(transactions.map((item) => periodKey(item.date)))].filter((value) => value < period).slice(-3).length;
  const confidence = elapsedDays >= 20 && historyCount >= 2 ? "high" : elapsedDays >= 10 || historyCount >= 2 ? "medium" : "low";
  return { period, asOfDate: asOf.toISOString().slice(0, 10), elapsedDays, daysInMonth, actualConsumption: cashFlow.consumption, projectedConsumption, projectedTotalOutflow, projectedNetCashFlow: cashFlow.income - projectedTotalOutflow, recurringStillExpected, confidence, explanation: `Estimate uses ${elapsedDays} elapsed day${elapsedDays === 1 ? "" : "s"}, the current consumption run rate, and recurring charges not yet observed. It is an estimate, not financial advice.` };
}

export function explainSpendingChange(transactions, requestedCurrent, requestedPrevious) {
  transactions = refineTransactionsForAnalysis(transactions);
  const periods = [...new Set(transactions.map((item) => periodKey(item.date)))].sort();
  const current = requestedCurrent || periods.at(-1) || "";
  const previous = requestedPrevious || periods[periods.indexOf(current) - 1] || "";
  const currentFlow = buildCashFlow(transactions, current);
  const previousFlow = buildCashFlow(transactions, previous);
  const categoryNames = [...new Set(transactions.map((item) => item.category))];
  const categoryDrivers = categoryNames.map((category) => {
    const now = sum(inPeriod(transactions, current).filter((item) => item.type === "debit" && item.category === category));
    const before = sum(inPeriod(transactions, previous).filter((item) => item.type === "debit" && item.category === category));
    return { category, current: now, previous: before, difference: now - before, changePercent: percentageChange(now, before) };
  }).filter((item) => item.difference !== 0).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  const merchantNames = [...new Set(transactions.map(merchantName))];
  const merchantDrivers = merchantNames.map((merchant) => {
    const now = sum(inPeriod(transactions, current).filter((item) => item.type === "debit" && merchantName(item) === merchant));
    const before = sum(inPeriod(transactions, previous).filter((item) => item.type === "debit" && merchantName(item) === merchant));
    return { merchant, current: now, previous: before, difference: now - before };
  }).filter((item) => item.difference !== 0).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  return { current, previous, currentCashFlow: currentFlow, previousCashFlow: previousFlow, consumptionChangePercent: percentageChange(currentFlow.consumption, previousFlow.consumption), categoryDrivers: categoryDrivers.slice(0, 8), merchantDrivers: merchantDrivers.slice(0, 8) };
}

export function suggestBudgets(transactions, bufferPercent = 10) {
  transactions = refineTransactionsForAnalysis(transactions);
  const periods = [...new Set(transactions.map((item) => periodKey(item.date)))].sort().slice(-3);
  const categories = [...new Set(transactions.filter((item) => item.type === "debit" && consumptionCategories.has(item.category)).map((item) => item.category))];
  return categories.map((category) => {
    const monthly = periods.map((period) => sum(inPeriod(transactions, period).filter((item) => item.type === "debit" && item.category === category)));
    const baseline = median(monthly);
    const limit = Math.ceil((baseline * (1 + Math.max(0, Math.min(50, bufferPercent)) / 100)) / 100) * 100;
    return { category, suggestedLimit: limit, baseline: Math.round(baseline), bufferPercent, monthsUsed: periods.length, confidence: periods.length >= 3 ? "high" : periods.length === 2 ? "medium" : "low" };
  }).filter((item) => item.suggestedLimit > 0).sort((a, b) => b.suggestedLimit - a.suggestedLimit);
}

export function explainBudgetExceeded(transactions, budgets, requestedCategory, requestedPeriod) {
  transactions = refineTransactionsForAnalysis(transactions);
  const period = requestedPeriod || latestPeriod(transactions);
  const rows = budgets.map((budget) => {
    const items = inPeriod(transactions, period).filter((item) => item.type === "debit" && item.category === budget.category);
    const spent = sum(items);
    return { category: budget.category, limit: budget.limit, spent, overBy: Math.max(0, spent - budget.limit), usedPercent: budget.limit ? spent / budget.limit * 100 : 0, topTransactions: [...items].sort((a, b) => b.amount - a.amount).slice(0, 5) };
  }).filter((item) => !requestedCategory || item.category.toLowerCase() === requestedCategory.toLowerCase()).sort((a, b) => b.overBy - a.overBy || b.usedPercent - a.usedPercent);
  return { period, budgets: rows, exceeded: rows.filter((item) => item.overBy > 0) };
}

export function findCostCutting(transactions, period) {
  const opportunities = findSavingsOpportunities(transactions, period);
  return { opportunities, totalMonthlyPotential: opportunities.reduce((total, item) => total + item.monthlyPotential, 0), totalAnnualPotential: opportunities.reduce((total, item) => total + item.annualPotential, 0) };
}

export function buildFinancialTimeline(transactions, budgets = [], limitMonths = 6) {
  transactions = refineTransactionsForAnalysis(transactions);
  const periods = [...new Set(transactions.map((item) => periodKey(item.date)))].sort().slice(-Math.max(1, Math.min(12, limitMonths)));
  const subscriptions = subscriptionRows(transactions);
  const events = [];
  periods.forEach((period, index) => {
    const flow = buildCashFlow(transactions, period);
    const previous = index ? buildCashFlow(transactions, periods[index - 1]) : null;
    const items = inPeriod(transactions, period);
    const consumption = items.filter((item) => item.type === "debit" && consumptionCategories.has(item.category));
    if (previous) {
      const change = percentageChange(flow.consumption, previous.consumption);
      if (change != null && Math.abs(change) >= 15 && Math.abs(flow.consumption - previous.consumption) >= 500) events.push({ id: `${period}-spending`, period, type: "spending_change", title: `Consumption ${change > 0 ? "rose" : "fell"} ${Math.abs(change).toFixed(0)}%`, detail: `${flow.consumption.toFixed(0)} versus ${previous.consumption.toFixed(0)} in ${periods[index - 1]}.`, amount: flow.consumption, changePercent: change, significance: Math.abs(change) >= 35 ? "high" : "medium", evidenceTransactionIds: consumption.map((item) => item.id) });
      if (Math.abs(flow.savingsRate - previous.savingsRate) >= 10) events.push({ id: `${period}-savings`, period, type: "savings_rate", title: `Savings rate ${flow.savingsRate > previous.savingsRate ? "improved" : "declined"}`, detail: `${flow.savingsRate.toFixed(1)}% versus ${previous.savingsRate.toFixed(1)}% in ${periods[index - 1]}.`, changePercent: flow.savingsRate - previous.savingsRate, significance: Math.abs(flow.savingsRate - previous.savingsRate) >= 20 ? "high" : "medium", evidenceTransactionIds: items.map((item) => item.id) });
      const investmentChange = percentageChange(flow.investmentContributions, previous.investmentContributions);
      if (investmentChange != null && Math.abs(flow.investmentContributions - previous.investmentContributions) >= 500 && Math.abs(investmentChange) >= 25) events.push({ id: `${period}-investment`, period, type: "investment", title: `Investment contributions ${investmentChange > 0 ? "increased" : "decreased"}`, detail: `${flow.investmentContributions.toFixed(0)} allocated in ${period}.`, amount: flow.investmentContributions, changePercent: investmentChange, significance: "medium", evidenceTransactionIds: items.filter((item) => item.category === INVESTMENT).map((item) => item.id) });
    }
    const top = grouped(consumption, (item) => item.category)[0];
    const previousTop = index ? grouped(inPeriod(transactions, periods[index - 1]).filter((item) => item.type === "debit" && consumptionCategories.has(item.category)), (item) => item.category)[0] : null;
    if (top && previousTop && top.label !== previousTop.label) events.push({ id: `${period}-category`, period, type: "category_shift", title: `${top.label} became the largest category`, detail: `${top.amount.toFixed(0)} across ${top.count} payment${top.count === 1 ? "" : "s"}.`, amount: top.amount, significance: "medium", evidenceTransactionIds: top.ids });
    for (const subscription of subscriptions.filter((item) => periodKey(transactions.find((transaction) => transaction.id === item.transactionIds[0])?.date) === period).slice(0, 2)) events.push({ id: `${period}-subscription-${slug(subscription.merchant)}`, period, type: "subscription", title: `${subscription.merchant} started recurring`, detail: `Estimated ${subscription.monthlyCost} per month from ${subscription.occurrences} observed payment${subscription.occurrences === 1 ? "" : "s"}.`, amount: subscription.monthlyCost, significance: subscription.monthlyCost >= 1000 ? "high" : "medium", evidenceTransactionIds: subscription.transactionIds });
    for (const budget of budgets) {
      const categoryItems = consumption.filter((item) => item.category === budget.category);
      const spent = sum(categoryItems);
      if (spent > budget.limit) events.push({ id: `${period}-budget-${slug(budget.category)}`, period, type: "budget", title: `${budget.category} exceeded its budget`, detail: `${spent.toFixed(0)} spent against a ${budget.limit.toFixed(0)} limit.`, amount: spent - budget.limit, significance: spent >= budget.limit * 1.25 ? "high" : "medium", evidenceTransactionIds: categoryItems.map((item) => item.id) });
    }
    const earlierMerchants = new Set(transactions.filter((item) => periodKey(item.date) < period).map(merchantName));
    for (const item of items.filter((transaction) => transaction.type === "debit" && transaction.amount >= 4999 && !earlierMerchants.has(merchantName(transaction))).slice(0, 1)) events.push({ id: `${period}-merchant-${item.id}`, period, type: "merchant", title: `New high-value payment to ${merchantName(item)}`, detail: `${item.amount.toFixed(0)} was the first observed payment to this merchant.`, amount: item.amount, significance: item.amount >= 10000 ? "high" : "medium", evidenceTransactionIds: [item.id] });
  });
  return events.sort((a, b) => a.period.localeCompare(b.period) || (a.significance === "high" ? -1 : 1)).slice(-12);
}

export function buildFinanceGraph(transactions, budgets = []) {
  transactions = refineTransactionsForAnalysis(transactions);
  const nodes = [], edges = [], seen = new Set();
  const addNode = (node) => { if (!seen.has(node.id)) { seen.add(node.id); nodes.push(node); } };
  const subscriptions = subscriptionRows(transactions);
  const subscriptionMerchants = new Set(subscriptions.map((item) => item.merchant));
  for (const item of transactions) {
    const merchant = merchantName(item), period = periodKey(item.date), subcategory = subcategoryFor(item);
    const transactionId = `transaction:${item.id}`, merchantId = `merchant:${slug(merchant)}`, categoryId = `category:${slug(item.category)}`, subcategoryId = `subcategory:${slug(subcategory)}`, periodId = `period:${period}`;
    addNode({ id: transactionId, type: "transaction", label: item.description, attributes: { amount: item.amount, direction: item.type, date: item.date } });
    addNode({ id: merchantId, type: "merchant", label: merchant }); addNode({ id: categoryId, type: "category", label: item.category }); addNode({ id: subcategoryId, type: "subcategory", label: subcategory }); addNode({ id: periodId, type: "period", label: period });
    edges.push({ from: transactionId, to: merchantId, type: "PAID_TO" }, { from: transactionId, to: categoryId, type: "IN_CATEGORY" }, { from: transactionId, to: subcategoryId, type: "IN_SUBCATEGORY" }, { from: transactionId, to: periodId, type: "OCCURRED_IN" });
    if (subscriptionMerchants.has(merchant)) { const subscriptionId = `subscription:${slug(merchant)}`; addNode({ id: subscriptionId, type: "subscription", label: merchant }); edges.push({ from: merchantId, to: subscriptionId, type: "RECURS_AS" }); }
  }
  for (const budget of budgets) { const categoryId = `category:${slug(budget.category)}`, budgetId = `budget:${slug(budget.category)}`; addNode({ id: categoryId, type: "category", label: budget.category }); addNode({ id: budgetId, type: "budget", label: `${budget.category} budget`, attributes: { limit: budget.limit } }); edges.push({ from: categoryId, to: budgetId, type: "HAS_BUDGET" }); }
  return { nodes, edges };
}

export function financialHealthReport(transactions, budgets = [], requestedPeriod) {
  transactions = refineTransactionsForAnalysis(transactions);
  const period = requestedPeriod || latestPeriod(transactions);
  const analysis = analyzeFinances(transactions, budgets, period);
  const budgetRows = explainBudgetExceeded(transactions, budgets, undefined, period).budgets;
  const recurringRatio = analysis.cashFlow.income ? analysis.subscriptions.reduce((total, item) => total + item.monthlyCost, 0) / analysis.cashFlow.income * 100 : 0;
  const breakdown = {
    savings: Math.max(0, Math.min(35, analysis.cashFlow.savingsRate * .7)),
    budget: budgets.length ? Math.max(0, 25 - budgetRows.filter((item) => item.overBy > 0).length * 8) : 15,
    recurring: Math.max(0, 20 - recurringRatio),
    consistency: Math.max(0, 20 - analysis.anomalies.length * 4),
  };
  const score = Math.round(Object.values(breakdown).reduce((total, value) => total + value, 0));
  return { period, score, label: score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 45 ? "Needs attention" : "At risk", breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, Math.round(value)])), cashFlow: analysis.cashFlow, classificationTotals: analysis.classificationTotals, subscriptions: analysis.subscriptions, anomalies: analysis.anomalies, savingsOpportunities: analysis.savingsOpportunities };
}

export function analyzeFinances(transactions, budgets = [], requestedPeriod) {
  transactions = refineTransactionsForAnalysis(transactions);
  const period = requestedPeriod || latestPeriod(transactions);
  const periods = [...new Set(transactions.map((item) => periodKey(item.date)))].sort();
  const previousPeriod = periods[periods.indexOf(period) - 1];
  const cashFlow = buildCashFlow(transactions, period);
  const previousCashFlow = previousPeriod ? buildCashFlow(transactions, previousPeriod) : undefined;
  const items = inPeriod(transactions, period);
  const consumption = items.filter((item) => item.type === "debit" && consumptionCategories.has(item.category));
  const subscriptions = subscriptionRows(transactions);
  const recurringNames = new Set(subscriptions.map((item) => item.merchant));
  const classifications = consumption.map((item) => classifyTransaction(item, recurringNames));
  const classificationById = new Map(classifications.map((item) => [item.transactionId, item]));
  const classifiedTotal = (field, value) => sum(consumption.filter((item) => classificationById.get(item.id)?.[field] === value));
  const byCategory = grouped(consumption, (item) => item.category).map((item) => ({ category: item.label, amount: item.amount, count: item.count, share: cashFlow.consumption ? item.amount / cashFlow.consumption * 100 : 0 }));
  const topMerchants = grouped(consumption, merchantName).map((item) => ({ merchant: item.label, amount: item.amount, count: item.count, share: cashFlow.consumption ? item.amount / cashFlow.consumption * 100 : 0 })).slice(0, 10);
  return {
    period,
    cashFlow,
    ...(previousCashFlow ? { previousCashFlow } : {}),
    consumptionChangePercent: previousCashFlow ? percentageChange(cashFlow.consumption, previousCashFlow.consumption) : null,
    byCategory,
    topMerchants,
    classifications,
    classificationTotals: { fixed: classifiedTotal("spendClass", "fixed"), variable: classifiedTotal("spendClass", "variable"), essential: classifiedTotal("necessity", "essential"), discretionary: classifiedTotal("necessity", "discretionary"), neutral: classifiedTotal("necessity", "neutral"), subscriptionShare: cashFlow.consumption ? subscriptions.reduce((total, item) => total + item.monthlyCost, 0) / cashFlow.consumption * 100 : 0 },
    largestTransaction: [...items.filter((item) => item.type === "debit")].sort((a, b) => b.amount - a.amount)[0],
    subscriptions,
    anomalies: anomalyRows(transactions),
    savingsOpportunities: findSavingsOpportunities(transactions, period),
    forecast: predictMonthEndSpending(transactions, period),
    timeline: buildFinancialTimeline(transactions, budgets, 6),
    graph: buildFinanceGraph(transactions, budgets),
  };
}
