import { NextResponse } from "next/server";
import { configuredProviders, generateWithFallback } from "../../../lib/ai-providers.mjs";
import { parseCsvFallback } from "../../../lib/finance";

export const runtime = "edge";

const transactionSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "string" }, date: { type: "string" }, merchant: { type: "string" }, description: { type: "string" }, amount: { type: "number" },
    type: { type: "string", enum: ["debit", "credit"] },
    category: { type: "string", enum: ["Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities", "EMI", "Investment", "Health", "Entertainment", "Travel", "Salary", "Income", "Transfers", "Miscellaneous", "Other"] },
    confidence: { type: "number" }, source: { type: "string" }, explanation: { type: "string" },
  },
  required: ["id", "date", "merchant", "description", "amount", "type", "category", "confidence", "source", "explanation"],
};

const statementSchema = {
  type: "object", additionalProperties: false,
  properties: {
    accountName: { type: "string" }, bankName: { type: "string" }, period: { type: "string" }, currency: { type: "string" },
    transactions: { type: "array", items: transactionSchema }, insights: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
  },
  required: ["accountName", "bankName", "period", "currency", "transactions", "insights"],
};

const systemPrompt = "You are Finora's bank-statement analyst. Extract transactions faithfully across Indian and international bank formats, card statements, UPI narrations, OCR-scanned PDFs, receipt images and spreadsheets. Never invent missing transactions. Normalize merchant variants such as AMZN PAY and AMAZON SELLER SERVICES to Amazon. Separate Salary, EMI, Investment and person-to-person Transfers from consumption spend. Use Miscellaneous only when no safer category fits. Explain every category in one short sentence. Confidence must be 0..1. Produce exactly three specific, useful insights grounded in the statement, including changes, recurring charges, duplicates, or anomalies when evidence supports them.";

function mediaFromDataUrl(fileData?: string, fallbackMimeType?: string) {
  if (!fileData) return undefined;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(fileData);
  if (!match) throw new Error("The uploaded document is not valid base64 data.");
  return { mimeType: fallbackMimeType || match[1], data: match[2] };
}

function parseModelJson(text: string) {
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
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
    const result = await generateWithFallback({
      system: systemPrompt,
      prompt: `${body.text || "Read every page of this financial statement and normalize every transaction."}\nSource filename: ${filename}\nAmounts must be positive; type carries debit/credit direction.`,
      schema: statementSchema,
      media: mediaFromDataUrl(body.fileData, body.mimeType),
    });
    return NextResponse.json({ ...parseModelJson(result.text), provider: result.provider, model: result.model });
  } catch (error) {
    const parsed = localResult();
    if (parsed) return NextResponse.json({ ...parsed, provider: "local" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The statement could not be processed by the configured providers." }, { status: 502 });
  }
}
