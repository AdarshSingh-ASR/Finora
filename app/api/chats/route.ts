import { and, desc, eq } from "drizzle-orm";
import { getAuth } from "../../../lib/auth";
import { getDb } from "../../../db";
import { chatThread } from "../../../db/schema";
import { sanitizeAnalystResponse, type AnalystResponse } from "../../../lib/analyst";
import { sanitizeAgentActions, type AgentAction, type ChatAttachmentMeta } from "../../../lib/agent-actions";
import { categories } from "../../../lib/finance";
import type { Category, StatementResult, Transaction } from "../../../lib/types";

type StoredMessage = { id: string; role: "user" | "assistant"; content: string; analysis?: AnalystResponse; actions?: AgentAction[]; attachments?: ChatAttachmentMeta[]; evidenceScope?: "attachments" | "combined" | "ledger" };
type StoredAttachment = ChatAttachmentMeta & { mimeType: string; status: "ready"; statement: StatementResult };

function cleanAttachments(input: unknown): ChatAttachmentMeta[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    if (typeof source.id !== "string" || typeof source.name !== "string") return [];
    const size = Number(source.size);
    const transactionCount = Number(source.transactionCount);
    return [{
      id: source.id.slice(0, 100),
      name: source.name.trim().slice(0, 180),
      size: Number.isFinite(size) ? Math.max(0, Math.min(size, 18 * 1024 * 1024)) : 0,
      transactionCount: Number.isFinite(transactionCount) ? Math.max(0, Math.min(Math.round(transactionCount), 20_000)) : 0,
    }];
  });
}

function cleanStatement(input: unknown): StatementResult | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  if (!Array.isArray(source.transactions) || source.transactions.length > 10_000) return null;
  const transactions = source.transactions.flatMap<Transaction>((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const amount = Math.abs(Number(row.amount));
    const type = row.type === "credit" ? "credit" : row.type === "debit" ? "debit" : null;
    const category = typeof row.category === "string" && categories.includes(row.category as Category) ? row.category as Category : "Miscellaneous";
    if (!Number.isFinite(amount) || amount <= 0 || !type || typeof row.date !== "string") return [];
    return [{
      id: typeof row.id === "string" ? row.id.slice(0, 100) : `chat-transaction-${index}`,
      date: row.date.slice(0, 40), merchant: String(row.merchant || "Unknown merchant").slice(0, 240),
      description: String(row.description || row.merchant || "Transaction").slice(0, 1_000), amount, type, category,
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)), source: String(row.source || "Chat attachment").slice(0, 180),
      explanation: String(row.explanation || "Categorized from the attached file.").slice(0, 500),
    }];
  });
  if (!transactions.length) return null;
  return {
    accountName: String(source.accountName || "Imported account").slice(0, 180), bankName: String(source.bankName || "Attached statement").slice(0, 180),
    period: String(source.period || "Imported statement").slice(0, 180), currency: String(source.currency || "INR").slice(0, 12), transactions,
    insights: Array.isArray(source.insights) ? source.insights.slice(0, 3).map((item) => String(item).slice(0, 500)) : [],
  };
}

function cleanAttachmentContext(input: unknown): StoredAttachment[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const [meta] = cleanAttachments([source]);
    const statement = cleanStatement(source.statement);
    if (!meta || !statement) return [];
    return [{ ...meta, transactionCount: statement.transactions.length, mimeType: String(source.mimeType || "application/octet-stream").slice(0, 120), status: "ready" as const, statement }];
  });
}

function storedPayload(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) return { messages: parsed, attachmentContext: [] };
  if (!parsed || typeof parsed !== "object") return { messages: [], attachmentContext: [] };
  const source = parsed as Record<string, unknown>;
  return { messages: Array.isArray(source.messages) ? source.messages : [], attachmentContext: cleanAttachmentContext(source.attachmentContext) };
}

async function currentUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user || null;
}

function cleanMessages(input: unknown): StoredMessage[] | null {
  if (!Array.isArray(input) || input.length > 80) return null;
  const messages = input.filter((item): item is StoredMessage => Boolean(item) && typeof item === "object" && typeof item.id === "string" && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({
      id: item.id.slice(0, 100), role: item.role, content: item.content.slice(0, 12_000),
      ...(item.analysis ? { analysis: sanitizeAnalystResponse(item.analysis) } : {}),
      ...(item.actions ? { actions: sanitizeAgentActions(item.actions) } : {}),
      ...(item.attachments ? { attachments: cleanAttachments(item.attachments) } : {}),
      ...(item.evidenceScope === "attachments" || item.evidenceScope === "combined" || item.evidenceScope === "ledger" ? { evidenceScope: item.evidenceScope } : {}),
    }));
  return messages.length === input.length ? messages : null;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const rows = await getDb().select().from(chatThread).where(eq(chatThread.userId, user.id)).orderBy(desc(chatThread.updatedAt)).limit(50);
  return Response.json({ chats: rows.map((row) => ({ id: row.id, title: row.title, ...storedPayload(row.messagesJson), createdAt: row.createdAt, updatedAt: row.updatedAt })) });
}

export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const id = typeof body.id === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(body.id) ? body.id : null;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const messages = cleanMessages(body.messages);
  const attachmentContext = cleanAttachmentContext(body.attachmentContext);
  if (!id || !title || !messages) return Response.json({ error: "A valid chat is required." }, { status: 400 });
  const messagesJson = JSON.stringify({ messages, attachmentContext });
  if (messagesJson.length > 4_500_000) return Response.json({ error: "This chat and its attached-file context are too large to save." }, { status: 413 });

  const db = getDb();
  const [existing] = await db.select({ userId: chatThread.userId, createdAt: chatThread.createdAt }).from(chatThread).where(eq(chatThread.id, id)).limit(1);
  if (existing && existing.userId !== user.id) return Response.json({ error: "Chat not found." }, { status: 404 });
  const now = new Date();
  if (existing) {
    await db.update(chatThread).set({ title, messagesJson, updatedAt: now }).where(and(eq(chatThread.id, id), eq(chatThread.userId, user.id)));
  } else {
    await db.insert(chatThread).values({ id, userId: user.id, title, messagesJson, createdAt: now, updatedAt: now });
  }
  return Response.json({ ok: true, updatedAt: now });
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Chat id is required." }, { status: 400 });
  await getDb().delete(chatThread).where(and(eq(chatThread.id, id), eq(chatThread.userId, user.id)));
  return Response.json({ ok: true });
}
