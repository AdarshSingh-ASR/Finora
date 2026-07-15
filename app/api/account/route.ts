import { eq } from "drizzle-orm";
import { getAuth } from "../../../lib/auth";
import { getDb } from "../../../db";
import { reportPreference, userLedger } from "../../../db/schema";

async function currentUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user || null;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const db = getDb();
  const [ledger] = await db.select().from(userLedger).where(eq(userLedger.userId, user.id)).limit(1);
  const [preference] = await db.select().from(reportPreference).where(eq(reportPreference.userId, user.id)).limit(1);
  return Response.json({
    ledger: ledger ? { statement: JSON.parse(ledger.statementJson), budgets: JSON.parse(ledger.budgetsJson), updatedAt: ledger.updatedAt } : null,
    preferences: preference || { weeklyEmailEnabled: false, timezone: "Asia/Kolkata", reportDay: 0, lastSentAt: null },
  });
}

export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const db = getDb();
  const now = new Date();

  if (body.statement && Array.isArray(body.budgets)) {
    const statementJson = JSON.stringify(body.statement);
    const budgetsJson = JSON.stringify(body.budgets);
    if (statementJson.length > 5_000_000) return Response.json({ error: "Ledger is too large." }, { status: 413 });
    await db.insert(userLedger).values({ userId: user.id, statementJson, budgetsJson, updatedAt: now })
      .onConflictDoUpdate({ target: userLedger.userId, set: { statementJson, budgetsJson, updatedAt: now } });
  }

  if (body.preferences && typeof body.preferences === "object") {
    const input = body.preferences as Record<string, unknown>;
    const timezone = typeof input.timezone === "string" && input.timezone.length < 80 ? input.timezone : "Asia/Kolkata";
    const weeklyEmailEnabled = input.weeklyEmailEnabled === true;
    await db.insert(reportPreference).values({ userId: user.id, weeklyEmailEnabled, timezone, reportDay: 0, updatedAt: now })
      .onConflictDoUpdate({ target: reportPreference.userId, set: { weeklyEmailEnabled, timezone, updatedAt: now } });
  }
  return Response.json({ ok: true });
}
