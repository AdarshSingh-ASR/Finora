import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentAuthRequest } from "../../../../db/schema";
import { getAuth } from "../../../../lib/auth";

export const runtime = "edge";

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json() as { userCode?: string };
  const userCode = (body.userCode || "").trim().toUpperCase();
  const db = getDb();
  const [pending] = await db.select().from(agentAuthRequest).where(and(
    eq(agentAuthRequest.userCode, userCode), eq(agentAuthRequest.status, "pending"), gt(agentAuthRequest.expiresAt, new Date()),
  )).limit(1);
  if (!pending) return Response.json({ error: "This link is invalid or expired." }, { status: 404 });
  await db.update(agentAuthRequest).set({ status: "approved", userId: session.user.id, approvedAt: new Date() }).where(eq(agentAuthRequest.id, pending.id));
  return Response.json({ ok: true, account: { name: session.user.name, email: session.user.email } });
}
