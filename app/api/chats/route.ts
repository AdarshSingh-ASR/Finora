import { and, desc, eq } from "drizzle-orm";
import { getAuth } from "../../../lib/auth";
import { getDb } from "../../../db";
import { chatThread } from "../../../db/schema";
import { sanitizeAnalystResponse, type AnalystResponse } from "../../../lib/analyst";
import { sanitizeAgentActions, type AgentAction, type ChatAttachmentMeta } from "../../../lib/agent-actions";

type StoredMessage = { id: string; role: "user" | "assistant"; content: string; analysis?: AnalystResponse; actions?: AgentAction[]; attachments?: ChatAttachmentMeta[] };

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
    }));
  return messages.length === input.length ? messages : null;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const rows = await getDb().select().from(chatThread).where(eq(chatThread.userId, user.id)).orderBy(desc(chatThread.updatedAt)).limit(50);
  return Response.json({ chats: rows.map((row) => ({ id: row.id, title: row.title, messages: JSON.parse(row.messagesJson), createdAt: row.createdAt, updatedAt: row.updatedAt })) });
}

export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const id = typeof body.id === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(body.id) ? body.id : null;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const messages = cleanMessages(body.messages);
  if (!id || !title || !messages) return Response.json({ error: "A valid chat is required." }, { status: 400 });
  const messagesJson = JSON.stringify(messages);
  if (messagesJson.length > 500_000) return Response.json({ error: "This chat is too large to save." }, { status: 413 });

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
