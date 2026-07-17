import { configuredProviders, generateWithFallback } from "./ai-providers.mjs";
import { normalizeMerchant, parseCsvFallback } from "./finance";
import { generateAdaptiveStatementRange } from "./statement-chunking.mjs";
import type { Category, StatementResult, Transaction } from "./types";

export type StatementInput = { filename?: string; mimeType?: string; fileData?: string; text?: string };

export class StatementProcessingError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

const categories = ["Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities", "EMI", "Investment", "Health", "Entertainment", "Travel", "Salary", "Income", "Transfers", "Miscellaneous", "Other"] as const;
const CHUNK_SIZE = 60;
const MAX_CHUNKS = 24;
const MINIMUM_ADAPTIVE_RANGE = 8;

const statementChunkSchema = {
  type: "object", additionalProperties: false,
  properties: {
    accountName: { type: "string" }, bankName: { type: "string" }, period: { type: "string" }, currency: { type: "string" },
    totalTransactionCount: { type: "integer", minimum: 0 },
    transactions: { type: "array", items: { type: "string" }, maxItems: CHUNK_SIZE },
    insights: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["accountName", "bankName", "period", "currency", "totalTransactionCount", "transactions", "insights"],
};

const systemPrompt = "You are Finora's bank-statement analyst. Extract transactions faithfully across Indian and international bank formats, card statements, UPI narrations, OCR-scanned PDFs, receipt images and spreadsheets. Never invent a row. Normalize merchant variants while retaining the original narration. Separate Salary, EMI, Investment and person-to-person Transfers from consumption. Confidence is 0..1. Return only the requested indexed transaction batch.";

function mediaFromDataUrl(fileData?: string, fallbackMimeType?: string) {
  if (!fileData) return undefined;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(fileData);
  if (!match) throw new Error("The uploaded document is not valid base64 data.");
  return { mimeType: fallbackMimeType || match[1], data: match[2] };
}

type CompactTransaction = { date: string; narration: string; merchant: string; amount: number; type: "debit" | "credit"; category: Category; confidence: number };
type StatementChunk = {
  accountName: string; bankName: string; period: string; currency: string; totalTransactionCount: number;
  transactions: string[]; insights: string[];
};
type GenerateInput = { system: string; prompt: string; schema: Record<string, unknown>; media?: { mimeType: string; data: string }; maxOutputTokens: number };
type GenerateResult = { text: string; provider: string; model: string };
export type StatementGenerator = (input: GenerateInput) => Promise<GenerateResult>;

function parseModelJson(text: string): StatementChunk {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned) as StatementChunk; }
  catch { throw new Error("The statement extraction returned an incomplete batch."); }
}

function parseCompactTransaction(row: string): CompactTransaction | null {
  const parts = String(row || "").split("|||");
  if (parts.length < 7) return null;
  const [date, direction, rawAmount, merchant, rawCategory, rawConfidence, ...narrationParts] = parts;
  const amount = Math.abs(Number(String(rawAmount).replace(/[^0-9.-]/g, "")));
  const narration = narrationParts.join("|||").replace(/\s+/g, " ").trim();
  if (!date.trim() || !narration || !Number.isFinite(amount) || amount <= 0) return null;
  const category = categories.includes(rawCategory.trim() as Category) ? rawCategory.trim() as Category : "Miscellaneous";
  return {
    date: date.trim(), type: /credit|cr|incoming/i.test(direction) ? "credit" : "debit", amount,
    merchant: merchant.trim() || normalizeMerchant(narration), category,
    confidence: Math.max(0, Math.min(1, Number(rawConfidence) || 0)), narration,
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function canonicalStatement(parsed: Omit<StatementChunk, "transactions" | "totalTransactionCount"> & { transactions: CompactTransaction[] }, filename: string): StatementResult {
  const occurrence = new Map<string, number>();
  const transactions = parsed.transactions.flatMap<Transaction>((row) => {
    const amount = Math.abs(Number(row.amount));
    const narration = String(row.narration || row.merchant || "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(amount) || amount <= 0 || !row.date || !narration) return [];
    const merchant = String(row.merchant || normalizeMerchant(narration)).trim() || normalizeMerchant(narration);
    const fingerprint = `${row.date}|${row.type}|${amount.toFixed(2)}|${merchant.toLowerCase()}|${narration.toLowerCase()}`;
    const number = (occurrence.get(fingerprint) || 0) + 1;
    occurrence.set(fingerprint, number);
    return [{
      id: `tx-${stableHash(`${fingerprint}|${number}`)}`, date: String(row.date), merchant, description: narration, amount,
      type: row.type === "credit" ? "credit" : "debit", category: row.category,
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)), source: filename,
      explanation: "Categorized from the statement narration.",
    }];
  });
  if (!transactions.length) throw new Error("No transactions could be read from this statement.");
  return {
    accountName: String(parsed.accountName || "Imported account"), bankName: String(parsed.bankName || filename),
    period: String(parsed.period || "Imported statement"), currency: String(parsed.currency || "INR"), transactions,
    insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3).map(String) : [],
  };
}

function extractionPrompt(filename: string, start: number, end: number, text?: string) {
  return `${text || "Read every page of this financial statement."}\nSource filename: ${filename}\nFirst count every transaction in document order. Return only transactions ${start} through ${end} inclusive (1-based); return an empty array if that range is past the end. Each transactions entry must be one compact string with exactly this order and delimiter:\ndate|||debit-or-credit|||positive-amount|||normalized-merchant|||category|||confidence|||original-narration\nDo not include the delimiter in a field. totalTransactionCount must be the count for the entire document. Include up to three concise insights only in the first batch; later batches may return an empty insights array.`;
}

function generatedChunkInput(body: StatementInput, filename: string, media: { mimeType: string; data: string } | undefined, start: number, end: number, retry: boolean) {
  const prompt = extractionPrompt(filename, start, end, body.text);
  const rangeSchema = {
    ...statementChunkSchema,
    properties: {
      ...statementChunkSchema.properties,
      transactions: { ...statementChunkSchema.properties.transactions, maxItems: end - start + 1 },
    },
  };
  return {
    system: systemPrompt,
    prompt: retry
      ? `${prompt}\nThis is the final retry for transactions ${start}-${end}. Keep each narration under 160 characters, return one complete JSON object, and close every string and array.`
      : `${prompt}\nThis range contains at most ${end - start + 1} transactions. Keep each narration under 240 characters so the JSON always completes.`,
    schema: rangeSchema,
    media,
    maxOutputTokens: 16384,
  };
}

async function extractInChunks(body: StatementInput, filename: string, generator: StatementGenerator) {
  const media = mediaFromDataUrl(body.fileData, body.mimeType);
  let metadata: StatementChunk | null = null;
  let provider = "";
  let model = "";
  const rows: CompactTransaction[] = [];
  let previousFingerprint = "";
  let expectedTotal = 0;
  let reachedDocumentEnd = false;

  for (let chunkIndex = 0; chunkIndex < MAX_CHUNKS; chunkIndex += 1) {
    const start = chunkIndex * CHUNK_SIZE + 1;
    const end = start + CHUNK_SIZE - 1;
    const results = await generateAdaptiveStatementRange({
      start,
      end,
      minimumRangeSize: MINIMUM_ADAPTIVE_RANGE,
      generate: async (rangeStart: number, rangeEnd: number, retry: boolean) => {
        const result = await generator(generatedChunkInput(body, filename, media, rangeStart, rangeEnd, retry));
        return { result, chunk: parseModelJson(result.text), rangeStart, rangeEnd };
      },
    }) as Array<{ result: GenerateResult; chunk: StatementChunk; rangeStart: number; rangeEnd: number }>;

    let rangeRowCount = 0;
    for (const { result, chunk } of results) {
      if (!metadata) metadata = chunk;
      provider = result.provider; model = result.model;
      expectedTotal = Math.max(expectedTotal, Math.max(0, Number(chunk.totalTransactionCount) || 0));
      const compactRows = Array.isArray(chunk.transactions) ? chunk.transactions.map(parseCompactTransaction).filter((row): row is CompactTransaction => Boolean(row)) : [];
      const fingerprint = compactRows.map((row) => `${row.date}|${row.type}|${row.amount}|${row.merchant}`).join("\n");
      if (fingerprint && fingerprint === previousFingerprint) throw new Error("The statement reader repeated a batch before reaching the end.");
      if (fingerprint) previousFingerprint = fingerprint;
      rows.push(...compactRows);
      rangeRowCount += compactRows.length;
    }

    reachedDocumentEnd = rangeRowCount < CHUNK_SIZE;
    if (reachedDocumentEnd || (expectedTotal && rows.length >= expectedTotal)) break;
  }

  if (!metadata || !rows.length) throw new Error("No transactions could be read from this statement.");
  if (!reachedDocumentEnd && expectedTotal > rows.length) throw new Error(`The statement reader found ${rows.length} of ${expectedTotal} transactions before reaching the configured safety limit.`);
  if (expectedTotal > rows.length) {
    metadata.insights = [
      ...(metadata.insights || []),
      `The document-reported count was ${expectedTotal}, while ${rows.length} transaction rows were present in the indexed ranges. Finora kept every row it could verify rather than failing the whole import.`,
    ].slice(0, 3);
  }
  return { statement: canonicalStatement({ ...metadata, transactions: rows }, filename), provider, model };
}

export async function processStatementInput(body: StatementInput, generator: StatementGenerator = generateWithFallback as StatementGenerator): Promise<StatementResult & { provider?: string; model?: string }> {
  const filename = body.filename || "statement";
  const localResult = () => body.text ? parseCsvFallback(body.text, filename) : null;
  const deterministic = localResult();
  if (deterministic) return { ...deterministic, provider: "local" };
  const providers = configuredProviders();
  if (!providers.vertex && !providers.groq) throw new StatementProcessingError("Document intelligence is not configured. Add Vertex AI credentials to process PDF or image statements.", 503);

  try {
    const result = await extractInChunks(body, filename, generator);
    return { ...result.statement, provider: result.provider, model: result.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The statement could not be processed by the configured providers.";
    const safeMessage = /JSON|unterminated|structured data|output limit|maximum token|batch|reader found/i.test(message)
      ? "One small range of the statement could not be read after Finora automatically divided the document into smaller batches. Please retry once; if it still fails, the affected pages may be unreadable or password-protected."
      : message;
    throw new StatementProcessingError(safeMessage, 502);
  }
}
