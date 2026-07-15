import { NextResponse } from "next/server";
import { parseCsvFallback } from "../../../lib/finance";
import { sampleStatement } from "../../../lib/sample-data";

export const runtime = "edge";

const transactionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" }, date: { type: "string" }, merchant: { type: "string" },
    description: { type: "string" }, amount: { type: "number" },
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
    transactions: { type: "array", items: transactionSchema },
    insights: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
  },
  required: ["accountName", "bankName", "period", "currency", "transactions", "insights"],
};

function outputText(json: any) {
  for (const item of json.output || []) for (const content of item.content || []) if (content.type === "output_text") return content.text;
  return "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { filename?: string; mimeType?: string; fileData?: string; text?: string };
    const filename = body.filename || "statement";
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      const parsed = body.text ? parseCsvFallback(body.text, filename) : null;
      return NextResponse.json(parsed || { ...sampleStatement, bankName: `${filename} · demo preview`, demo: true });
    }

    const isImage = body.mimeType?.startsWith("image/");
    const userContent: any[] = [];
    if (body.fileData) {
      userContent.push(isImage
        ? { type: "input_image", image_url: body.fileData }
        : { type: "input_file", filename, file_data: body.fileData });
    }
    userContent.push({
      type: "input_text",
      text: body.text || "Read every page of this financial statement and normalize every transaction. Amounts must be positive; type carries debit/credit direction.",
    });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6",
        reasoning: { effort: "medium" },
        input: [
          { role: "system", content: [{ type: "input_text", text: "You are Finora's bank-statement analyst. Extract transactions faithfully across Indian and international bank formats, card statements, UPI narrations, OCR-scanned PDFs, receipt images and spreadsheets. Never invent missing transactions. Normalize merchant variants such as AMZN PAY and AMAZON SELLER SERVICES to Amazon. Separate Salary, EMI, Investment and person-to-person Transfers from consumption spend. Use Miscellaneous only when no safer category fits. Explain every category in one short sentence. Confidence must be 0..1. Produce exactly three specific, useful insights grounded in the statement, including changes, recurring charges, duplicates, or anomalies when evidence supports them." }] },
          { role: "user", content: userContent },
        ],
        text: { format: { type: "json_schema", name: "finora_statement", strict: true, schema: statementSchema } },
      }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message || "OpenAI request failed");
    const text = outputText(json);
    if (!text) throw new Error("The model returned no structured statement.");
    return NextResponse.json(JSON.parse(text));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not analyze this statement." }, { status: 400 });
  }
}
