import { NextResponse } from "next/server";
import { configuredProviders, generateWithFallback } from "../../../lib/ai-providers.mjs";
import { normalizeMerchant, parseCsvFallback } from "../../../lib/finance";
import type { Category, StatementResult, Transaction } from "../../../lib/types";

export const runtime = "edge";

const transactionSchema = {
  type: "object", additionalProperties: false,
  properties: {
    date: { type: "string" }, narration: { type: "string" }, merchant: { type: "string" }, amount: { type: "number" },
    type: { type: "string", enum: ["debit", "credit"] },
    category: { type: "string", enum: ["Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities", "EMI", "Investment", "Health", "Entertainment", "Travel", "Salary", "Income", "Transfers", "Miscellaneous", "Other"] },
    confidence: { type: "number" },
  },
  required: ["date", "narration", "merchant", "amount", "type", "category", "confidence"],
};

const statementSchema = {
  type: "object", additionalProperties: false,
  properties: {
    accountName: { type: "string" }, bankName: { type: "string" }, period: { type: "string" }, currency: { type: "string" },
    transactions: { type: "array", items: transactionSchema }, insights: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
  },
  required: ["accountName", "bankName", "period", "currency", "transactions", "insights"],
};

const systemPrompt = "You are Finora's bank-statement analyst. Extract every transaction faithfully across Indian and international bank formats, card statements, UPI narrations, OCR-scanned PDFs, receipt images and spreadsheets. Never invent or omit transactions. Return compact values: keep narration faithful but remove redundant whitespace, and do not add explanations. Normalize merchant variants such as AMZN PAY and AMAZON SELLER SERVICES to Amazon. Separate Salary, EMI, Investment and person-to-person Transfers from consumption spend. Use Miscellaneous only when no safer category fits. Confidence must be 0..1. Produce exactly three concise, specific insights grounded in the statement, including changes, recurring charges, duplicates, or anomalies when evidence supports them.";

function mediaFromDataUrl(fileData?: string, fallbackMimeType?: string) {
  if (!fileData) return undefined;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(fileData);
  if (!match) throw new Error("The uploaded document is not valid base64 data.");
  return { mimeType: fallbackMimeType || match[1], data: match[2] };
}

type CompactStatement = {
  accountName: string;
  bankName: string;
  period: string;
  currency: string;
  transactions: Array<{
    date: string;
    narration: string;
    merchant: string;
    amount: number;
    type: "debit" | "credit";
    category: Category;
    confidence: number;
  }>;
  insights: string[];
};

function parseModelJson(text: string): CompactStatement {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned) as CompactStatement;
  } catch {
    throw new Error("The statement extraction was incomplete. Please retry the file; if it is unusually large, export it as CSV or split the PDF by date range.");
  }
}

function canonicalStatement(parsed: CompactStatement, filename: string): StatementResult {
  const transactions = parsed.transactions.flatMap<Transaction>((row) => {
    const amount = Math.abs(Number(row.amount));
    const narration = String(row.narration || row.merchant || "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(amount) || amount <= 0 || !row.date || !narration) return [];
    return [{
      id: crypto.randomUUID(),
      date: String(row.date),
      merchant: String(row.merchant || normalizeMerchant(narration)).trim() || normalizeMerchant(narration),
      description: narration,
      amount,
      type: row.type === "credit" ? "credit" : "debit",
      category: row.category,
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
      source: filename,
      explanation: "Categorized from the statement narration.",
    }];
  });
  if (!transactions.length) throw new Error("No transactions could be read from this statement.");
  return {
    accountName: String(parsed.accountName || "Imported account"),
    bankName: String(parsed.bankName || filename),
    period: String(parsed.period || "Imported statement"),
    currency: String(parsed.currency || "INR"),
    transactions,
    insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3).map(String) : [],
  };
}

export async function POST(request: Request) {
  const body = await request.json() as { filename?: string; mimeType?: string; fileData?: string; text?: string };
  const filename = body.filename || "statement";
  const localResult = () => body.text ? parseCsvFallback(body.text, filename) : null;
  if (!configuredProviders().vertex && !configuredProviders().groq) {
    const parsed = localResult();
    return parsed ? NextResponse.json(parsed) : NextResponse.json({ error: "Document intelligence is not configured. Add Vertex AI credentials to process PDF or image statements." }, { status: 503 });
  }

  try {
    const extraction = {
      system: systemPrompt,
      prompt: `${body.text || "Read every page of this financial statement and normalize every transaction."}\nSource filename: ${filename}\nAmounts must be positive; type carries debit/credit direction.`,
      schema: statementSchema,
      media: mediaFromDataUrl(body.fileData, body.mimeType),
      maxOutputTokens: 65535,
    };
    let result;
    try {
      result = await generateWithFallback(extraction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/incomplete structured data|output limit/i.test(message)) throw error;
      result = await generateWithFallback({
        ...extraction,
        prompt: `${extraction.prompt}\nThe previous response was cut off. Return one complete, valid JSON object. Keep narration compact and close every string, array, and object.`,
      });
    }
    return NextResponse.json({ ...canonicalStatement(parseModelJson(result.text), filename), provider: result.provider, model: result.model });
  } catch (error) {
    const parsed = localResult();
    if (parsed) return NextResponse.json({ ...parsed, provider: "local" });
    const message = error instanceof Error ? error.message : "The statement could not be processed by the configured providers.";
    const safeMessage = /JSON|unterminated|structured data|output limit|maximum token/i.test(message)
      ? "The statement extraction was incomplete. Please retry the file; if it is unusually large, export it as CSV or split the PDF by date range."
      : message;
    return NextResponse.json({ error: safeMessage }, { status: 502 });
  }
}
