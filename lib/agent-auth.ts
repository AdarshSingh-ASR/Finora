import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { agentAccessToken } from "../db/schema";

const encoder = new TextEncoder();

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomSecret(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${prefix}${token}`;
}

export function randomUserCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const value = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export async function agentIdentity(request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("finora_agent_")) return null;
  const tokenHash = await sha256(token);
  const db = getDb();
  const now = new Date();
  const [record] = await db.select().from(agentAccessToken).where(and(
    eq(agentAccessToken.tokenHash, tokenHash),
    isNull(agentAccessToken.revokedAt),
    gt(agentAccessToken.expiresAt, now),
  )).limit(1);
  if (!record) return null;
  await db.update(agentAccessToken).set({ lastUsedAt: now }).where(eq(agentAccessToken.id, record.id));
  return { userId: record.userId, tokenId: record.id };
}
