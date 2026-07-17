import { and, eq } from "drizzle-orm";
import { POST as answerWithFinora } from "../ask/route";
import { getDb } from "../../../db";
import { account, reportPreference, userLedger } from "../../../db/schema";
import { agentIdentity } from "../../../lib/agent-auth";
import {
  budgetStatus, categories, compareMonths, detectAnomalies, detectSubscriptions, financialHealthScore,
  findDuplicateTransactions, monthlySummaries, normalizeMerchant, summarize, weeklyReport,
} from "../../../lib/finance";
import {
  connectSpreadsheet, copySpreadsheet, createSpreadsheet, disconnectSpreadsheet, getSheetConnection,
  GoogleWorkspaceError, moveSpreadsheet, renameSpreadsheet, shareSpreadsheet, syncSpreadsheet,
} from "../../../lib/google-sheets";
import { processStatementInput } from "../../../lib/statement-parser";
import type { Budget, StatementResult } from "../../../lib/types";

export const runtime = "edge";

const capabilities = [
  "skill_sync", "import_statement", "save_ledger", "list_transactions", "categorize_transactions", "normalize_merchants", "correct_category", "set_budgets", "summary", "monthly_summary",
  "spending_trends", "compare_months", "merchant_analysis", "search_transactions", "detect_subscriptions",
  "find_duplicates", "detect_anomalies", "budget_status", "financial_health_score", "weekly_report",
  "answer_finance_question", "sheet_status", "sync_sheets", "sheet_connect", "sheet_rename", "sheet_copy", "sheet_move", "sheet_share", "sheet_disconnect", "report_settings",
];

async function loadLedger(userId: string) {
  const [row] = await getDb().select().from(userLedger).where(eq(userLedger.userId, userId)).limit(1);
  if (!row) return null;
  return { statement: JSON.parse(row.statementJson) as StatementResult, budgets: JSON.parse(row.budgetsJson) as Budget[], updatedAt: row.updatedAt };
}

async function saveLedger(userId: string, statement: StatementResult, budgets: Budget[] = []) {
  const statementJson = JSON.stringify(statement);
  if (statementJson.length > 5_000_000) throw new Error("Ledger is too large.");
  const now = new Date();
  await getDb().insert(userLedger).values({ userId, statementJson, budgetsJson: JSON.stringify(budgets), updatedAt: now })
    .onConflictDoUpdate({ target: userLedger.userId, set: { statementJson, budgetsJson: JSON.stringify(budgets), updatedAt: now } });
  return now;
}

function sheetFailure(error: unknown, request: Request) {
  if (error instanceof GoogleWorkspaceError) return Response.json({
    error: error.message, code: error.code,
    actionRequired: error.code === "GOOGLE_PERMISSION_REQUIRED" ? "Open Finora and connect Google Sheets." : undefined,
    actionUrl: error.code === "GOOGLE_PERMISSION_REQUIRED" ? `${new URL(request.url).origin}/connect?capability=sheets` : undefined,
  }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 400 });
}

export async function GET(request: Request) {
  const identity = await agentIdentity(request);
  if (!identity) return Response.json({ error: "Connect your Finora account first." }, { status: 401 });
  const ledger = await loadLedger(identity.userId);
  return Response.json({ connected: true, capabilities, transactionCount: ledger?.statement.transactions.length || 0, ledgerUpdatedAt: ledger?.updatedAt || null });
}

export async function POST(request: Request) {
  const identity = await agentIdentity(request);
  if (!identity) return Response.json({ error: "Connect your Finora account first." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "skill_sync";
  const ledger = await loadLedger(identity.userId);
  const statement = ledger?.statement;
  const transactions = statement?.transactions || [];
  const budgets = ledger?.budgets || [];

  try {
    if (action === "skill_sync") {
      const [sheet, preference] = await Promise.all([
        getSheetConnection(identity.userId),
        getDb().select().from(reportPreference).where(eq(reportPreference.userId, identity.userId)).limit(1).then((rows) => rows[0] || null),
      ]);
      return Response.json({ connected: true, transactionCount: transactions.length, periods: monthlySummaries(transactions).map((item) => item.period), sheet, reportPreference: preference });
    }
    if (action === "import_statement") {
      const parsed = await processStatementInput({ filename: String(body.filename || "statement"), mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined, fileData: typeof body.fileData === "string" ? body.fileData : undefined, text: typeof body.text === "string" ? body.text : undefined });
      const replace = body.replace === true;
      const mergedTransactions = !replace && statement ? [...statement.transactions, ...parsed.transactions].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id || (candidate.date === item.date && candidate.amount === item.amount && candidate.description === item.description)) === index) : parsed.transactions;
      const saved = { ...parsed, transactions: mergedTransactions, provider: undefined, model: undefined } as StatementResult;
      await saveLedger(identity.userId, saved, budgets);
      return Response.json({ imported: parsed.transactions.length, totalTransactions: saved.transactions.length, statement: saved });
    }
    if (action === "save_ledger") {
      if (!body.statement || typeof body.statement !== "object") return Response.json({ error: "statement is required." }, { status: 400 });
      await saveLedger(identity.userId, body.statement as StatementResult, Array.isArray(body.budgets) ? body.budgets as Budget[] : budgets);
      return Response.json({ ok: true });
    }
    if (action === "sheet_status") return Response.json({ connection: await getSheetConnection(identity.userId) });
    if (!statement) return Response.json({ error: "Import a statement before using this action.", code: "LEDGER_REQUIRED" }, { status: 409 });
    if (action === "list_transactions" || action === "categorize_transactions") return Response.json({ transactions, count: transactions.length });
    if (action === "normalize_merchants") {
      const normalized = transactions.map((item) => ({ ...item, merchant: normalizeMerchant(item.merchant || item.description) }));
      if (body.persist === true) await saveLedger(identity.userId, { ...statement, transactions: normalized }, budgets);
      return Response.json({ transactions: normalized, persisted: body.persist === true });
    }
    if (action === "correct_category") {
      const transactionId = String(body.transactionId || "");
      const category = String(body.category || "");
      if (!categories.includes(category as never)) return Response.json({ error: "Choose a valid category.", categories }, { status: 400 });
      const updated = transactions.map((item) => item.id === transactionId ? { ...item, category: category as typeof item.category, confidence: 1, explanation: "Confirmed by the user." } : item);
      if (!updated.some((item, index) => item !== transactions[index])) return Response.json({ error: "Transaction not found." }, { status: 404 });
      await saveLedger(identity.userId, { ...statement, transactions: updated }, budgets);
      return Response.json({ ok: true, transaction: updated.find((item) => item.id === transactionId) });
    }
    if (action === "set_budgets") {
      if (!Array.isArray(body.budgets)) return Response.json({ error: "budgets must be an array." }, { status: 400 });
      const nextBudgets = (body.budgets as Budget[]).filter((item) => categories.includes(item.category) && Number.isFinite(item.limit) && item.limit >= 0);
      await saveLedger(identity.userId, statement, nextBudgets);
      return Response.json({ ok: true, budgets: nextBudgets });
    }
    if (action === "summary") return Response.json({ summary: summarize(transactions), transactionCount: transactions.length });
    if (action === "monthly_summary" || action === "spending_trends") return Response.json({ months: monthlySummaries(transactions) });
    if (action === "compare_months") return Response.json(compareMonths(transactions, typeof body.current === "string" ? body.current : undefined, typeof body.previous === "string" ? body.previous : undefined));
    if (action === "detect_subscriptions") return Response.json({ subscriptions: detectSubscriptions(transactions) });
    if (action === "find_duplicates") return Response.json({ duplicates: findDuplicateTransactions(transactions) });
    if (action === "detect_anomalies") return Response.json({ anomalies: detectAnomalies(transactions) });
    if (action === "budget_status") return Response.json({ budgets: budgetStatus(transactions, budgets, typeof body.period === "string" ? body.period : undefined) });
    if (action === "financial_health_score") return Response.json(financialHealthScore(transactions, budgets));
    if (action === "weekly_report") return Response.json(weeklyReport(transactions));
    if (action === "merchant_analysis" || action === "search_transactions") {
      const query = String(body.query || body.merchant || "").trim().toLowerCase();
      const filtered = transactions.filter((item) => !query || `${item.merchant} ${item.description} ${item.category} ${item.date}`.toLowerCase().includes(query));
      return Response.json({ transactions: filtered.slice(0, 500), count: filtered.length, total: filtered.reduce((sum, item) => sum + item.amount, 0) });
    }
    if (action === "answer_finance_question") {
      const question = String(body.question || "").trim();
      return answerWithFinora(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history: body.history, transactions, budgets }) }));
    }
    if (action === "sync_sheets") {
      const connection = await getSheetConnection(identity.userId);
      return Response.json({ connection: connection ? await syncSpreadsheet(identity.userId) : await createSpreadsheet(identity.userId, body.name) });
    }
    if (action === "sheet_connect") return Response.json({ connection: await connectSpreadsheet(identity.userId, String(body.spreadsheetId || "")) });
    if (action === "sheet_rename") return Response.json({ connection: await renameSpreadsheet(identity.userId, body.name) });
    if (action === "sheet_copy") return Response.json({ connection: await copySpreadsheet(identity.userId, body.name) });
    if (action === "sheet_move") return Response.json({ connection: await moveSpreadsheet(identity.userId, String(body.folderId || "")) });
    if (action === "sheet_share") return Response.json({ connection: await shareSpreadsheet(identity.userId, String(body.email || "")) });
    if (action === "sheet_disconnect") { await disconnectSpreadsheet(identity.userId); return Response.json({ ok: true }); }
    if (action === "report_settings") {
      const enabled = body.enabled === true;
      const frequency = body.frequency === "monthly" ? "monthly" : "weekly";
      const timezone = typeof body.timezone === "string" ? body.timezone.slice(0, 80) : "Asia/Kolkata";
      if (enabled) {
        const [google] = await getDb().select({ scope: account.scope }).from(account).where(and(eq(account.userId, identity.userId), eq(account.providerId, "google"))).limit(1);
        if (!google?.scope?.includes("https://www.googleapis.com/auth/gmail.send")) return Response.json({
          error: "Connect Gmail permission before enabling AI report delivery.", code: "GOOGLE_PERMISSION_REQUIRED",
          actionRequired: "Open Finora and approve Gmail report delivery.",
          actionUrl: `${new URL(request.url).origin}/connect?capability=gmail&frequency=${frequency}`,
        }, { status: 403 });
      }
      const now = new Date();
      await getDb().insert(reportPreference).values({ userId: identity.userId, weeklyEmailEnabled: enabled, frequency, timezone, reportDay: 0, updatedAt: now })
        .onConflictDoUpdate({ target: reportPreference.userId, set: { weeklyEmailEnabled: enabled, frequency, timezone, updatedAt: now } });
      return Response.json({ ok: true, enabled, frequency, timezone, note: enabled ? "Google Gmail permission must already be connected in Finora." : undefined });
    }
    return Response.json({ error: "Unknown action.", capabilities }, { status: 400 });
  } catch (error) { return sheetFailure(error, request); }
}
