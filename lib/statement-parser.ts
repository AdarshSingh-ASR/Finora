import { configuredProviders, generateWithFallback } from "./ai-providers.mjs";
import { categories, normalizeMerchant, parseCsvFallback, refineTransaction } from "./finance";
import { generateAdaptiveStatementRange, isRecoverableStatementError } from "./statement-chunking.mjs";
import { configuredChunkConcurrency, createStatementTextChunks, mapWithConcurrency } from "./statement-text-chunking.mjs";
import type { ExtractedPdfPage, StatementExtractionMode, StatementTextChunk } from "./statement-extraction";
import type { Category, StatementResult, Transaction } from "./types";

export type StatementInput = {
  filename?: string;
  mimeType?: string;
  fileData?: string;
  text?: string;
  extractedPages?: ExtractedPdfPage[];
  extractionMode?: StatementExtractionMode;
};

export class StatementProcessingError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

const CHUNK_SIZE = 60;
const MAX_CHUNKS = 24;
const MINIMUM_ADAPTIVE_RANGE = 8;
const TEXT_CHUNK_MAX_TRANSACTIONS = 120;
const MAX_CONCURRENT_CHUNKS = configuredChunkConcurrency(process.env.MAX_CONCURRENT_CHUNKS, 3);

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

const textStatementChunkSchema = {
  ...statementChunkSchema,
  properties: {
    ...statementChunkSchema.properties,
    transactions: { type: "array", items: { type: "string" }, maxItems: TEXT_CHUNK_MAX_TRANSACTIONS },
  },
};

const systemPrompt = "You are Finora's bank-statement analyst. Extract transactions faithfully across Indian and international bank formats, card statements, UPI narrations, OCR-scanned PDFs, receipt images and spreadsheets. Never invent a row. Normalize merchant variants while retaining the original narration. Separate Salary, EMI, Investment and person-to-person Transfers from consumption. Prefer a specific evidence-supported category; use Miscellaneous only when merchant and purpose signals are genuinely insufficient. Confidence is 0..1. Return only the transactions requested from the provided document or independent text section.";

function mediaFromDataUrl(fileData?: string, fallbackMimeType?: string) {
  if (!fileData) return undefined;
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(fileData);
  if (!match) throw new Error("The uploaded document is not valid base64 data.");
  return { mimeType: fallbackMimeType || match[1], data: match[2] };
}

type CompactTransaction = { date: string; narration: string; merchant: string; amount: number; type: "debit" | "credit"; category: Category; confidence: number };
type StatementChunk = {
  accountName: string; bankName: string; period: string; currency: string; totalTransactionCount: number;
  transactions: string[]; insights: string[];
};
type GenerateInput = { system: string; prompt: string; schema: Record<string, unknown>; media?: { mimeType: string; data: string }; maxOutputTokens: number };
type GenerateResult = { text: string; provider: NonNullable<StatementResult["provider"]>; model: string };
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

function parseSimpleTextLayerLocally(pages: ExtractedPdfPage[], filename: string) {
  const lines = pages.flatMap((page) => page.lines || []).map((line) => String(line).replace(/\s+/g, " ").trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /\bdate\b/i.test(line) && /description|narration|details|merchant|particular/i.test(line) && /\bamount\b/i.test(line) && /dr\s*\/\s*cr|debit\s*\/\s*credit|\btype\b/i.test(line) && !/balance|closing/i.test(line));
  if (headerIndex < 0) return null;
  const date = "(?:\\d{1,2}[\\/.-]\\d{1,2}[\\/.-](?:\\d{2}|\\d{4})|\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{2,4})";
  const amount = "(?:₹|INR|Rs\\.?)?\\s*([\\d,]+(?:\\.\\d{1,2})?)";
  const trailingDirection = new RegExp(`^(${date})\\s+(.+?)\\s+${amount}\\s+(Dr|Cr|Debit|Credit)$`, "i");
  const leadingDirection = new RegExp(`^(${date})\\s+(.+?)\\s+(Dr|Cr|Debit|Credit)\\s+${amount}$`, "i");
  const csvRows: string[] = [];
  const csv = (value: string) => `"${value.replaceAll('"', '""')}"`;
  for (const line of lines.slice(headerIndex + 1)) {
    const trailing = trailingDirection.exec(line);
    const leading = trailing ? null : leadingDirection.exec(line);
    if (trailing) csvRows.push([trailing[1], trailing[2], trailing[3], trailing[4]].map(csv).join(","));
    else if (leading) csvRows.push([leading[1], leading[2], leading[4], leading[3]].map(csv).join(","));
  }
  if (csvRows.length < 2) return null;
  return parseCsvFallback(`Date,Description,Amount,Type\n${csvRows.join("\n")}`, filename);
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
    const transaction: Transaction = {
      id: `tx-${stableHash(`${fingerprint}|${number}`)}`, date: String(row.date), merchant, description: narration, amount,
      type: row.type === "credit" ? "credit" : "debit", category: row.category,
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)), source: filename,
      explanation: "Categorized from the statement narration.",
    };
    return [refineTransaction(transaction, { catchAllOnly: true }) as Transaction];
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

function textChunkInput(filename: string, chunk: StatementTextChunk, retry = false) {
  const prompt = `Extract every transaction from the following layout-preserving statement text. The text is an independent section from pages ${chunk.startPage}-${chunk.endPage}; do not infer rows from outside it. Repeated headers, footers, balances and totals are not transactions.\nSource filename: ${filename}\nEach transactions entry must be one compact string with exactly this order and delimiter:\ndate|||debit-or-credit|||positive-amount|||normalized-merchant|||category|||confidence|||original-narration\nDo not include the delimiter in a field. totalTransactionCount must equal the number of transactions present in this text section. Preserve their source order.\n\n${chunk.text}`;
  return {
    system: systemPrompt,
    prompt: retry
      ? `${prompt}\nThis is a final retry. Keep each narration under 160 characters and return one complete JSON object with every string and array closed.`
      : `${prompt}\nKeep each narration under 240 characters and return only the complete structured result.`,
    schema: textStatementChunkSchema,
    maxOutputTokens: 16384,
  };
}

function splitTextChunk(chunk: StatementTextChunk): [StatementTextChunk, StatementTextChunk] | null {
  const lines = chunk.text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 12 || chunk.text.length < 2400) return null;
  const midpoint = Math.floor(lines.length / 2);
  const boundaryPattern = /^(?:--- Page \d+ ---|\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{2}|\d{4})\b|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b)/i;
  const boundaries = lines.map((line, index) => boundaryPattern.test(line.trim()) ? index : -1).filter((index) => index >= 4 && index <= lines.length - 4);
  const splitAt = boundaries.sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))[0] || midpoint;
  return [
    { ...chunk, id: `${chunk.id}-a`, text: lines.slice(0, splitAt).join("\n") },
    { ...chunk, id: `${chunk.id}-b`, text: lines.slice(splitAt).join("\n") },
  ];
}

async function generateTextChunkAdaptive(chunk: StatementTextChunk, filename: string, generator: StatementGenerator, retry = false): Promise<Array<{ result: GenerateResult; chunk: StatementChunk; source: StatementTextChunk }>> {
  try {
    const result = await generator(textChunkInput(filename, chunk, retry));
    const parsed = parseModelJson(result.text);
    const returned = Array.isArray(parsed.transactions) ? parsed.transactions.length : 0;
    const reported = Math.max(0, Number(parsed.totalTransactionCount) || 0);
    if (reported > returned) throw new Error(`The statement extraction returned an incomplete batch (${returned} of ${reported}).`);
    return [{ result, chunk: parsed, source: chunk }];
  } catch (error) {
    if (!isRecoverableStatementError(error)) throw error;
    const halves = splitTextChunk(chunk);
    if (halves) {
      const left = await generateTextChunkAdaptive(halves[0], filename, generator);
      const right = await generateTextChunkAdaptive(halves[1], filename, generator);
      return [...left, ...right];
    }
    if (!retry) return generateTextChunkAdaptive(chunk, filename, generator, true);
    throw error;
  }
}

async function extractFromTextPages(body: StatementInput, filename: string, generator: StatementGenerator) {
  const chunks = createStatementTextChunks(body.extractedPages || []);
  if (!chunks.length) throw new Error("The PDF text layer did not contain readable statement rows.");
  const generated = await mapWithConcurrency(chunks, MAX_CONCURRENT_CHUNKS, (chunk: StatementTextChunk) => generateTextChunkAdaptive(chunk, filename, generator)) as Array<Array<{ result: GenerateResult; chunk: StatementChunk; source: StatementTextChunk }>>;
  const ordered = generated.flat();
  let metadata: StatementChunk | null = null;
  let provider: GenerateResult["provider"] | undefined;
  let model = "";
  let expectedTotal = 0;
  const rows: CompactTransaction[] = [];
  for (const item of ordered) {
    if (!metadata) metadata = item.chunk;
    provider = item.result.provider; model = item.result.model;
    expectedTotal += Math.max(0, Number(item.chunk.totalTransactionCount) || 0);
    rows.push(...(Array.isArray(item.chunk.transactions) ? item.chunk.transactions.map(parseCompactTransaction).filter((row: CompactTransaction | null): row is CompactTransaction => Boolean(row)) : []));
  }
  if (!metadata || !rows.length) throw new Error("No transactions could be read from the extracted PDF text.");
  if (expectedTotal > rows.length) throw new Error(`The statement extraction returned an incomplete batch (${rows.length} of ${expectedTotal}).`);
  return { statement: canonicalStatement({ ...metadata, transactions: rows }, filename), provider, model };
}

async function extractInChunks(body: StatementInput, filename: string, generator: StatementGenerator) {
  const media = mediaFromDataUrl(body.fileData, body.mimeType);
  let metadata: StatementChunk | null = null;
  let provider: GenerateResult["provider"] | undefined;
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
  const deterministicPdf = body.extractionMode === "text-layer" && body.extractedPages?.length ? parseSimpleTextLayerLocally(body.extractedPages, filename) : null;
  if (deterministicPdf) return { ...deterministicPdf, provider: "local" };
  const providers = configuredProviders();
  if (!providers.vertex && !providers.groq) throw new StatementProcessingError("Document intelligence is not configured. Add Vertex AI credentials to process PDF or image statements.", 503);

  try {
    const result = body.extractionMode === "text-layer" && body.extractedPages?.length
      ? await extractFromTextPages(body, filename, generator)
      : await extractInChunks(body, filename, generator);
    return { ...result.statement, provider: result.provider, model: result.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The statement could not be processed by the configured providers.";
    const safeMessage = /JSON|unterminated|structured data|output limit|maximum token|batch|reader found/i.test(message)
      ? "One small range of the statement could not be read after Finora automatically divided the document into smaller batches. Please retry once; if it still fails, the affected pages may be unreadable or password-protected."
      : message;
    throw new StatementProcessingError(safeMessage, 502);
  }
}
