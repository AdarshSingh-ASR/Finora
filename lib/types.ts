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
  demo?: boolean;
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

