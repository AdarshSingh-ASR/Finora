import { NextResponse } from "next/server";
import { generateWithFallback } from "../../../lib/ai-providers.mjs";
import { answerFinanceQuestion } from "../../../lib/finance";
import type { Budget, Transaction } from "../../../lib/types";

export const runtime = "edge";

export async function POST(request: Request) {
  const { question, transactions, budgets } = await request.json() as { question: string; transactions: Transaction[]; budgets?: Budget[] };
  if (!question?.trim() || !Array.isArray(transactions)) return NextResponse.json({ error: "Question and transactions are required." }, { status: 400 });
  try {
    const result = await generateWithFallback({
      system: "You are Finora, a concise evidence-based personal finance analyst. Answer only from the supplied ledger. Treat Investments and Transfers separately from consumption. Mention exact merchants and amounts when relevant. Flag uncertainty. Do not provide investment, tax, or legal advice.",
      prompt: `Question: ${question}\n\nBudgets: ${JSON.stringify(budgets || [])}\n\nLedger: ${JSON.stringify(transactions)}`,
    });
    return NextResponse.json({ answer: result.text, provider: result.provider, model: result.model });
  } catch {
    return NextResponse.json({ answer: answerFinanceQuestion(question, transactions, budgets), provider: "local", demo: true });
  }
}
