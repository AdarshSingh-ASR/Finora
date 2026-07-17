export type Category =
  | "Food & Dining"
  | "Housing"
  | "Transport"
  | "Shopping"
  | "Bills & Utilities"
  | "Health"
  | "Entertainment"
  | "Travel"
  | "EMI"
  | "Investment"
  | "Salary"
  | "Income"
  | "Transfers"
  | "Miscellaneous"
  | "Other";

export type Transaction = {
  id: string;
  date: string;
  merchant: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  category: Category;
  confidence: number;
  source: string;
  explanation: string;
};

export type StatementResult = {
  accountName: string;
  bankName: string;
  period: string;
  currency: string;
  transactions: Transaction[];
  insights: string[];
  provider?: "vertex" | "groq" | "local";
  model?: string;
};

export type Subscription = {
  merchant: string;
  monthlyCost: number;
  annualCost: number;
  occurrences: number;
  estimatedRenewalDate: string;
  confidence: number;
  transactionIds: string[];
};

export type DuplicateMatch = {
  id: string;
  merchant: string;
  amount: number;
  minutesApart: number;
  transactionIds: [string, string];
};

export type SpendingAnomaly = {
  id: string;
  severity: "medium" | "high";
  title: string;
  detail: string;
  transactionId?: string;
};

export type Budget = { category: Category; limit: number };

export type CashFlowBreakdown = {
  period: string;
  income: number;
  consumption: number;
  transfers: number;
  investmentContributions: number;
  totalOutflow: number;
  netCashFlow: number;
  savingsRate: number;
  transactionCount: number;
};

export type SpendingClassification = {
  transactionId: string;
  spendClass: "fixed" | "variable";
  necessity: "essential" | "discretionary" | "neutral";
  subcategory: string;
  confidence: number;
  explanation: string;
};

export type SavingsOpportunity = {
  id: string;
  kind: "subscription" | "category_change" | "merchant_pattern";
  title: string;
  detail: string;
  monthlyPotential: number;
  annualPotential: number;
  confidence: number;
  evidenceTransactionIds: string[];
};

export type MonthEndForecast = {
  period: string;
  asOfDate: string;
  elapsedDays: number;
  daysInMonth: number;
  actualConsumption: number;
  projectedConsumption: number;
  projectedTotalOutflow: number;
  projectedNetCashFlow: number;
  recurringStillExpected: number;
  confidence: "low" | "medium" | "high";
  explanation: string;
};

export type FinancialTimelineEvent = {
  id: string;
  period: string;
  type: "spending_change" | "category_shift" | "subscription" | "anomaly" | "budget" | "savings_rate" | "investment" | "merchant";
  title: string;
  detail: string;
  amount?: number;
  changePercent?: number;
  significance: "medium" | "high";
  evidenceTransactionIds: string[];
};

export type FinanceGraphNode = {
  id: string;
  type: "transaction" | "merchant" | "category" | "subcategory" | "period" | "subscription" | "budget" | "anomaly";
  label: string;
  attributes?: Record<string, string | number | boolean>;
};

export type FinanceGraphEdge = {
  from: string;
  to: string;
  type: "PAID_TO" | "IN_CATEGORY" | "IN_SUBCATEGORY" | "OCCURRED_IN" | "RECURS_AS" | "HAS_BUDGET" | "TRIGGERED_ANOMALY";
};

export type FinanceGraph = { nodes: FinanceGraphNode[]; edges: FinanceGraphEdge[] };

export type FinanceAnalysis = {
  period: string;
  cashFlow: CashFlowBreakdown;
  previousCashFlow?: CashFlowBreakdown;
  consumptionChangePercent: number | null;
  byCategory: Array<{ category: string; amount: number; count: number; share: number }>;
  topMerchants: Array<{ merchant: string; amount: number; count: number; share: number }>;
  classifications: SpendingClassification[];
  classificationTotals: {
    fixed: number;
    variable: number;
    essential: number;
    discretionary: number;
    neutral: number;
    subscriptionShare: number;
  };
  largestTransaction?: Transaction;
  subscriptions: Subscription[];
  anomalies: SpendingAnomaly[];
  savingsOpportunities: SavingsOpportunity[];
  forecast: MonthEndForecast;
  timeline: FinancialTimelineEvent[];
  graph: FinanceGraph;
};
