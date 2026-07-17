import type { Budget, FinanceAnalysis, FinanceGraph, FinancialTimelineEvent, MonthEndForecast, SavingsOpportunity, SpendingClassification, Transaction } from "./types";

export function classifyTransaction(transaction: Transaction, recurringMerchantNames?: Set<string>): SpendingClassification;
export function buildCashFlow(transactions: Transaction[], period?: string): FinanceAnalysis["cashFlow"];
export function findSavingsOpportunities(transactions: Transaction[], period?: string): SavingsOpportunity[];
export function predictMonthEndSpending(transactions: Transaction[], period?: string): MonthEndForecast;
export function buildFinancialTimeline(transactions: Transaction[], budgets?: Budget[], limitMonths?: number): FinancialTimelineEvent[];
export function buildFinanceGraph(transactions: Transaction[], budgets?: Budget[]): FinanceGraph;
export function analyzeFinances(transactions: Transaction[], budgets?: Budget[], period?: string): FinanceAnalysis;
export function explainSpendingChange(transactions: Transaction[], current?: string, previous?: string): {
  current: string; previous: string; currentCashFlow: FinanceAnalysis["cashFlow"]; previousCashFlow: FinanceAnalysis["cashFlow"];
  consumptionChangePercent: number | null;
  categoryDrivers: Array<{ category: string; current: number; previous: number; difference: number; changePercent: number | null }>;
  merchantDrivers: Array<{ merchant: string; current: number; previous: number; difference: number }>;
};
export function explainBudgetExceeded(transactions: Transaction[], budgets: Budget[], category?: string, period?: string): {
  period: string; budgets: Array<{ category: string; limit: number; spent: number; overBy: number; usedPercent: number; topTransactions: Transaction[] }>;
  exceeded: Array<{ category: string; limit: number; spent: number; overBy: number; usedPercent: number; topTransactions: Transaction[] }>;
};
export function suggestBudgets(transactions: Transaction[], bufferPercent?: number): Array<{ category: string; suggestedLimit: number; baseline: number; bufferPercent: number; monthsUsed: number; confidence: "low" | "medium" | "high" }>;
export function findCostCutting(transactions: Transaction[], period?: string): { opportunities: SavingsOpportunity[]; totalMonthlyPotential: number; totalAnnualPotential: number };
export function financialHealthReport(transactions: Transaction[], budgets?: Budget[], period?: string): {
  period: string; score: number; label: string; breakdown: Record<string, number>; cashFlow: FinanceAnalysis["cashFlow"];
  classificationTotals: FinanceAnalysis["classificationTotals"]; subscriptions: FinanceAnalysis["subscriptions"];
  anomalies: FinanceAnalysis["anomalies"]; savingsOpportunities: SavingsOpportunity[];
};
