export type Category =
  | "Food & Dining"
  | "Housing"
  | "Transport"
  | "Shopping"
  | "Bills & Utilities"
  | "Health"
  | "Entertainment"
  | "Travel"
  | "Income"
  | "Transfers"
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

