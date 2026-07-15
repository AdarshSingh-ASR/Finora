import type { StatementResult } from "./types";

export const sampleStatement: StatementResult = {
  accountName: "Everyday account",
  bankName: "HDFC Bank · UPI",
  period: "01 Jul — 15 Jul 2026",
  currency: "INR",
  insights: [
    "Food delivery is 31% higher than your last comparable period.",
    "Three recurring charges total ₹2,347 this month.",
    "At this pace, you can safely spend ₹21,840 before month-end.",
  ],
  transactions: [
    { id: "t01", date: "2026-07-15", merchant: "Salary", description: "NEFT ACME DESIGN LABS SALARY JUL", amount: 142000, type: "credit", category: "Income", confidence: 0.99, source: "HDFC statement", explanation: "Incoming NEFT marked as salary." },
    { id: "t02", date: "2026-07-15", merchant: "The Whole Truth", description: "UPI/THE WHOLE TRUTH/742119", amount: 1249, type: "debit", category: "Food & Dining", confidence: 0.94, source: "HDFC statement", explanation: "Food brand merchant matched with high confidence." },
    { id: "t03", date: "2026-07-14", merchant: "Uber", description: "UPI/UBER INDIA SYSTEMS/902481", amount: 486, type: "debit", category: "Transport", confidence: 0.99, source: "HDFC statement", explanation: "Known ride-hailing merchant." },
    { id: "t04", date: "2026-07-13", merchant: "Rent", description: "IMPS/RENT JULY/ADARSH HOMES", amount: 32000, type: "debit", category: "Housing", confidence: 0.98, source: "HDFC statement", explanation: "Narration explicitly identifies monthly rent." },
    { id: "t05", date: "2026-07-12", merchant: "Swiggy", description: "UPI/SWIGGY/441902", amount: 786, type: "debit", category: "Food & Dining", confidence: 0.99, source: "HDFC statement", explanation: "Known food-delivery merchant." },
    { id: "t06", date: "2026-07-11", merchant: "Cult.fit", description: "SI CULTFIT HEALTHCARE", amount: 1799, type: "debit", category: "Health", confidence: 0.96, source: "HDFC statement", explanation: "Fitness subscription recognized from merchant and standing instruction." },
    { id: "t07", date: "2026-07-10", merchant: "Amazon", description: "UPI/AMAZON PAY INDIA/880214", amount: 4289, type: "debit", category: "Shopping", confidence: 0.82, source: "HDFC statement", explanation: "General retail purchase; review if this was a bill payment." },
    { id: "t08", date: "2026-07-09", merchant: "BESCOM", description: "BBPS BESCOM ELECTRICITY", amount: 2840, type: "debit", category: "Bills & Utilities", confidence: 0.99, source: "HDFC statement", explanation: "Electricity bill paid through BBPS." },
    { id: "t09", date: "2026-07-08", merchant: "IndiGo", description: "POS INDIGO AIRLINES BLR", amount: 12840, type: "debit", category: "Travel", confidence: 0.98, source: "HDFC statement", explanation: "Airline purchase recognized from merchant." },
    { id: "t10", date: "2026-07-07", merchant: "Netflix", description: "SI NETFLIX.COM", amount: 649, type: "debit", category: "Entertainment", confidence: 0.99, source: "HDFC statement", explanation: "Recurring video subscription." },
    { id: "t11", date: "2026-07-06", merchant: "Blinkit", description: "UPI/BLINKIT/118702", amount: 2146, type: "debit", category: "Food & Dining", confidence: 0.93, source: "HDFC statement", explanation: "Grocery delivery categorized as food." },
    { id: "t12", date: "2026-07-05", merchant: "Myntra", description: "UPI/MYNTRA DESIGNS/441232", amount: 3699, type: "debit", category: "Shopping", confidence: 0.98, source: "HDFC statement", explanation: "Known apparel retailer." },
    { id: "t13", date: "2026-07-04", merchant: "UPI transfer", description: "UPI/ROHAN K/982102", amount: 4500, type: "debit", category: "Transfers", confidence: 0.68, source: "HDFC statement", explanation: "Person-to-person transfer; purpose is not visible in the statement." },
    { id: "t14", date: "2026-07-03", merchant: "Jio", description: "BBPS RELIANCE JIO POSTPAID", amount: 1099, type: "debit", category: "Bills & Utilities", confidence: 0.99, source: "HDFC statement", explanation: "Mobile bill paid through BBPS." },
    { id: "t15", date: "2026-07-02", merchant: "Blue Tokai", description: "UPI/BLUE TOKAI COFFEE/117704", amount: 620, type: "debit", category: "Food & Dining", confidence: 0.98, source: "HDFC statement", explanation: "Known café merchant." },
    { id: "t16", date: "2026-07-01", merchant: "SIP · Nifty 50", description: "ACH/UTI NIFTY 50 INDEX FUND", amount: 15000, type: "debit", category: "Transfers", confidence: 0.91, source: "HDFC statement", explanation: "Investment contribution treated as a transfer, not consumption." },
  ],
};

export const categoryColors: Record<string, string> = {
  "Food & Dining": "#ff6b35",
  Housing: "#275dff",
  Transport: "#ffd43b",
  Shopping: "#d8a7ff",
  "Bills & Utilities": "#53c7a5",
  Health: "#ff8fab",
  Entertainment: "#7f8cff",
  Travel: "#1f9dff",
  Income: "#2c9f6b",
  Transfers: "#8b8b80",
  Other: "#c6c6bb",
};

