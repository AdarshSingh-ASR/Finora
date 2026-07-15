import { NextResponse } from "next/server";
import { answerFinanceQuestion } from "../../../lib/finance";
import type { Budget, Transaction } from "../../../lib/types";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const { question, transactions, budgets } = await request.json() as { question: string; transactions: Transaction[]; budgets?: Budget[] };
    if (!question?.trim() || !Array.isArray(transactions)) return NextResponse.json({ error: "Question and transactions are required." }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ answer: answerFinanceQuestion(question, transactions, budgets), demo: true });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6",
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: "You are Finora, a concise evidence-based personal finance analyst. Answer only from the supplied ledger. Treat Investments and Transfers separately from consumption. Mention exact merchants and amounts when relevant. Flag uncertainty. Do not provide investment, tax, or legal advice." },
          { role: "user", content: `Question: ${question}\n\nBudgets: ${JSON.stringify(budgets || [])}\n\nLedger: ${JSON.stringify(transactions)}` },
        ],
      }),
    });
    const json = await response.json(); if (!response.ok) throw new Error(json?.error?.message || "OpenAI request failed");
    const answer = json.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === "output_text")?.text;
    return NextResponse.json({ answer: answer || answerFinanceQuestion(question, transactions, budgets) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not answer that question." }, { status: 400 }); }
}
