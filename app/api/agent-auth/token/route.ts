import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentAccessToken, agentAuthRequest } from "../../../../db/schema";
import { agentIdentity, randomSecret, sha256 } from "../../../../lib/agent-auth";

export const runtime = "edge";

export async function POST(request: Request) {
  const body = await request.json() as { deviceCode?: string; name?: string };
  const deviceCode = body.deviceCode || "";
  if (!deviceCode.startsWith("finora_device_")) return Response.json({ error: "invalid_request" }, { status: 400 });
  const db = getDb();
  const [pending] = await db.select().from(agentAuthRequest).where(and(
    eq(agentAuthRequest.deviceCodeHash, await sha256(deviceCode)), gt(agentAuthRequest.expiresAt, new Date()), isNull(agentAuthRequest.exchangedAt),
  )).limit(1);
  if (!pending) return Response.json({ error: "expired_token" }, { status: 400 });
  if (pending.status !== "approved" || !pending.userId) return Response.json({ error: "authorization_pending" }, { status: 428 });
  const token = randomSecret("finora_agent_");
  const now = new Date();
  await db.insert(agentAccessToken).values({
    id: crypto.randomUUID(), userId: pending.userId, tokenHash: await sha256(token),
    name: (body.name || "Finora skill").slice(0, 80), createdAt: now,
    expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000),
  });
  await db.update(agentAuthRequest).set({ exchangedAt: now, status: "exchanged" }).where(eq(agentAuthRequest.id, pending.id));
  return Response.json({ accessToken: token, tokenType: "Bearer", expiresIn: 90 * 24 * 60 * 60 });
}

export async function DELETE(request: Request) {
  const identity = await agentIdentity(request);
  if (!identity) return Response.json({ error: "Unauthorized." }, { status: 401 });
  await getDb().update(agentAccessToken).set({ revokedAt: new Date() }).where(eq(agentAccessToken.id, identity.tokenId));
  return Response.json({ ok: true });
}
