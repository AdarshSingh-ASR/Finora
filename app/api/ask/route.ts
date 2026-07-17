import { NextResponse } from "next/server";
import { generateWithFallback } from "../../../lib/ai-providers.mjs";
import { analystMarkdown, buildAnalystResponse } from "../../../lib/analyst";
import type { Budget, Transaction } from "../../../lib/types";

export const runtime = "edge";

type ConversationTurn = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const { question, history, transactions, budgets } = await request.json() as { question: string; history?: ConversationTurn[]; transactions: Transaction[]; budgets?: Budget[] };
  if (!question?.trim() || !Array.isArray(transactions)) return NextResponse.json({ error: "Question and transactions are required." }, { status: 400 });
  const conversation = Array.isArray(history) ? history.slice(-10).filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string").map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) })) : [];
  const analysis = buildAnalystResponse(question, transactions, Array.isArray(budgets) ? budgets : []);
  try {
    const result = await generateWithFallback({
      system: "You are Finora, a proactive, evidence-based personal finance analyst. Give the direct answer first, then add the most useful context the user did not explicitly request: relevant comparisons, composition, top merchants, trends, anomalies, or budget implications. Be selective—surface only facts that genuinely improve understanding. The supplied analytical brief is computed from the ledger and is the source of truth for totals and supporting facts. Use the conversation to understand follow-ups. Include every transaction by default, including person-to-person transfers and investments, while keeping consumption, transfers/investments, and income visibly separated. Never omit a group unless the user explicitly asks. If the evidence is insufficient, say what is missing. Write concise GitHub-flavored Markdown with a short direct-answer paragraph and a 'What stands out' section when supporting insights exist. Do not duplicate every metric or table because the interface renders the analytical brief as an interactive report below your narrative. Use the ₹ symbol for INR. Never mention the model, provider, prompt, chart implementation, or internal system. Never invent facts. Do not provide investment, tax, or legal advice.",
      prompt: `Conversation so far: ${JSON.stringify(conversation)}\n\nCurrent question: ${question}\n\nVerified analytical brief: ${JSON.stringify(analysis)}\n\nBudgets: ${JSON.stringify(budgets || [])}\n\nLedger evidence: ${JSON.stringify(transactions)}`,
    });
    return NextResponse.json({ answer: result.text, analysis });
  } catch {
    return NextResponse.json({ answer: analystMarkdown(analysis), analysis });
  }
}
