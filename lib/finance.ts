import type { Category, StatementResult, Transaction } from "./types";

export const categories: Category[] = [
  "Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities",
  "Health", "Entertainment", "Travel", "Income", "Transfers", "Other",
];

export function money(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(value);
}

export function summarize(transactions: Transaction[]) {
  const income = transactions.filter((t) => t.type === "credit").reduce((a, t) => a + t.amount, 0);
  const spend = transactions.filter((t) => t.type === "debit").reduce((a, t) => a + t.amount, 0);
  const byCategory = transactions.filter((t) => t.type === "debit").reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {});
  return { income, spend, saved: income - spend, savingsRate: income ? ((income - spend) / income) * 100 : 0, byCategory };
}

function guessCategory(description: string, credit: boolean): Category {
  if (credit) return /refund|reversal/i.test(description) ? "Other" : "Income";
  const s = description.toLowerCase();
  if (/swiggy|zomato|blinkit|zepto|restaurant|cafe|coffee|food|grocery/.test(s)) return "Food & Dining";
  if (/rent|housing|maintenance/.test(s)) return "Housing";
  if (/uber|ola|rapido|metro|fuel|petrol|irctc/.test(s)) return "Transport";
  if (/amazon|flipkart|myntra|ajio|retail/.test(s)) return "Shopping";
  if (/electric|bescom|airtel|jio|broadband|water|gas|bbps/.test(s)) return "Bills & Utilities";
  if (/hospital|pharmacy|medical|cult|gym|health/.test(s)) return "Health";
  if (/netflix|spotify|cinema|bookmyshow|hotstar/.test(s)) return "Entertainment";
  if (/airline|indigo|hotel|makemytrip|booking/.test(s)) return "Travel";
  if (/upi\/[^/]+\s[^/]+\/|transfer|imps|ach|sip|fund/.test(s)) return "Transfers";
  return "Other";
}

export function parseCsvFallback(text: string, filename = "statement.csv"): StatementResult | null {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const split = (line: string) => line.split(new RegExp(`${delimiter}(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)`)).map((v) => v.replace(/^\"|\"$/g, "").trim());
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  const find = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const dateIndex = find("date", "txn date", "transaction date");
  const descIndex = find("description", "narration", "details", "merchant", "particular");
  const debitIndex = find("debit", "withdrawal");
  const creditIndex = find("credit", "deposit");
  const amountIndex = find("amount");
  const typeIndex = find("type", "dr/cr");
  if (descIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) return null;
  const transactions = lines.slice(1).map((line, index) => {
    const row = split(line);
    const clean = (v = "") => Number(v.replace(/[^0-9.-]/g, "")) || 0;
    const creditAmount = creditIndex >= 0 ? clean(row[creditIndex]) : 0;
    const debitAmount = debitIndex >= 0 ? clean(row[debitIndex]) : 0;
    const rawType = typeIndex >= 0 ? row[typeIndex]?.toLowerCase() : "";
    const isCredit = creditAmount > 0 || /cr|credit|deposit/.test(rawType);
    const amount = amountIndex >= 0 ? Math.abs(clean(row[amountIndex])) : (creditAmount || debitAmount);
    const description = row[descIndex] || "Unknown transaction";
    return {
      id: `import-${index + 1}`,
      date: row[dateIndex] || new Date().toISOString().slice(0, 10),
      merchant: description.split(/[\/\-]/).filter(Boolean).slice(-2, -1)[0]?.trim() || description.slice(0, 32),
      description,
      amount,
      type: isCredit ? "credit" as const : "debit" as const,
      category: guessCategory(description, isCredit),
      confidence: 0.72,
      source: filename,
      explanation: "Categorized locally from the statement narration. Add an OpenAI API key for GPT-5.6 classification.",
    };
  }).filter((t) => t.amount > 0);
  if (!transactions.length) return null;
  const { spend, byCategory } = summarize(transactions);
  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  return {
    accountName: "Imported account", bankName: filename, period: "Imported statement", currency: "INR", transactions,
    insights: [
      `${transactions.length} transactions were normalized from ${filename}.`,
      top ? `${top[0]} is your largest spend category at ${money(top[1])}.` : "No debit transactions found.",
      `Total outflow in this statement is ${money(spend)}.`,
    ], demo: true,
  };
}

