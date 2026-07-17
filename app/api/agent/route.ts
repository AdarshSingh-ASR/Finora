import { and, eq } from "drizzle-orm";
import { POST as answerWithFinora } from "../ask/route";
import { getDb } from "../../../db";
import { account, reportPreference, userLedger } from "../../../db/schema";
import { agentIdentity } from "../../../lib/agent-auth";
import {
  analyzeFinances, buildFinanceGraph, buildFinancialTimeline, explainBudgetExceeded, explainSpendingChange,
  budgetStatus, categories, compareMonths, detectAnomalies, detectSubscriptions, financialHealthScore,
  financialHealthReport, findCostCutting, findDuplicateTransactions, findSavingsOpportunities,
  monthlySummaries, money, normalizeMerchant, predictMonthEndSpending, suggestBudgets, summarize, weeklyReport,
} from "../../../lib/finance";
import {
  addSpreadsheetTab, appendSpreadsheetRows, clearSpreadsheetRange, connectSpreadsheet, copySpreadsheet, createSpreadsheet,
  deleteSpreadsheet, deleteSpreadsheetTab, disconnectSpreadsheet, getSheetConnection, GoogleWorkspaceError, inspectSpreadsheet,
  moveSpreadsheet, readSpreadsheetRange, renameSpreadsheet, shareSpreadsheet, syncSpreadsheet, unshareSpreadsheet, updateSpreadsheetRange,
} from "../../../lib/google-sheets";
import { processStatementInput } from "../../../lib/statement-parser";
import type { Budget, StatementResult } from "../../../lib/types";

export const runtime = "edge";

const capabilities = [
  "sync_statement", "analyze_finances", "generate_dashboard", "find_savings", "financial_health_report",
  "explain_spending_change", "why_is_budget_exceeded", "suggest_budget", "find_cost_cutting", "predict_month_end_spending", "financial_timeline", "finance_graph",
  "skill_sync", "import_statement", "save_ledger", "add_transaction", "delete_transactions", "list_transactions", "categorize_transactions", "normalize_merchants", "correct_category", "set_budgets", "remove_budget", "summary", "monthly_summary", "monthly_report",
  "spending_trends", "compare_months", "merchant_analysis", "search_transactions", "detect_subscriptions",
  "find_duplicates", "detect_anomalies", "budget_status", "financial_health_score", "weekly_report",
  "answer_finance_question", "sheet_status", "sheet_inspect", "sync_sheets", "sheet_connect", "sheet_rename", "sheet_copy", "sheet_move", "sheet_share", "sheet_unshare",
  "sheet_add_tab", "sheet_delete_tab", "sheet_read_range", "sheet_append_rows", "sheet_update_range", "sheet_clear_range", "sheet_disconnect", "sheet_delete", "report_settings", "report_settings_clear",
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
    if (action === "sync_statement") {
      const parsed = await processStatementInput({ filename: String(body.filename || "statement"), mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined, fileData: typeof body.fileData === "string" ? body.fileData : undefined, text: typeof body.text === "string" ? body.text : undefined });
      const replace = body.replace === true;
      const mergedTransactions = !replace && statement ? [...statement.transactions, ...parsed.transactions].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id || (candidate.date === item.date && candidate.amount === item.amount && candidate.description === item.description)) === index) : parsed.transactions;
      const saved = { ...parsed, transactions: mergedTransactions, provider: undefined, model: undefined } as StatementResult;
      await saveLedger(identity.userId, saved, budgets);
      const analysis = analyzeFinances(saved.transactions, budgets, typeof body.period === "string" ? body.period : undefined);
      let sheet = null;
      if (body.syncSheets === true) {
        const connection = await getSheetConnection(identity.userId);
        sheet = connection ? await syncSpreadsheet(identity.userId, saved) : await createSpreadsheet(identity.userId, body.name, saved);
      }
      return Response.json({ summary: `Imported ${parsed.transactions.length} transactions and analyzed ${analysis.period || "the ledger"}${sheet ? "; Google Sheets is updated" : ""}.`, imported: parsed.transactions.length, totalTransactions: saved.transactions.length, statement: saved, analysis, sheet });
    }
    if (action === "save_ledger") {
      if (!body.statement || typeof body.statement !== "object") return Response.json({ error: "statement is required." }, { status: 400 });
      await saveLedger(identity.userId, body.statement as StatementResult, Array.isArray(body.budgets) ? body.budgets as Budget[] : budgets);
      return Response.json({ ok: true });
    }
    if (action === "sheet_status") return Response.json({ connection: await getSheetConnection(identity.userId) });
    if (action === "sheet_inspect") return Response.json({ workbook: await inspectSpreadsheet(identity.userId) });
    if (!statement) return Response.json({ error: "Import a statement before using this action.", code: "LEDGER_REQUIRED" }, { status: 409 });
    if (action === "add_transaction") {
      const category = String(body.category || "Miscellaneous");
      const amount = Number(body.amount);
      const merchant = String(body.merchant || "").trim();
      const date = String(body.date || "").trim();
      const type = body.type === "credit" || body.direction === "credit" ? "credit" : "debit";
      if (!merchant || !date || !Number.isFinite(amount) || amount <= 0 || !categories.includes(category as never)) return Response.json({ error: "Provide a valid date, merchant, positive amount, direction, and category.", categories }, { status: 400 });
      const transaction = { id: crypto.randomUUID(), date, merchant, description: String(body.description || merchant).trim(), amount, type, category: category as typeof transactions[number]["category"], confidence: 1, source: "Finora agent", explanation: "Added and confirmed through the Finora skill." };
      await saveLedger(identity.userId, { ...statement, transactions: [...transactions, transaction] }, budgets);
      return Response.json({ ok: true, transaction });
    }
    if (action === "delete_transactions") {
      const ids = new Set(Array.isArray(body.transactionIds) ? body.transactionIds.slice(0, 500).map(String) : []);
      if (!ids.size) return Response.json({ error: "transactionIds must contain at least one transaction ID." }, { status: 400 });
      const updated = transactions.filter((item) => !ids.has(item.id));
      const deleted = transactions.length - updated.length;
      if (!deleted) return Response.json({ error: "No matching transactions were found." }, { status: 404 });
      await saveLedger(identity.userId, { ...statement, transactions: updated }, budgets);
      return Response.json({ ok: true, deleted, transactionCount: updated.length });
    }
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
    if (action === "remove_budget") {
      const category = String(body.category || "");
      const nextBudgets = budgets.filter((item) => item.category !== category);
      if (nextBudgets.length === budgets.length) return Response.json({ error: "Budget not found." }, { status: 404 });
      await saveLedger(identity.userId, statement, nextBudgets);
      return Response.json({ ok: true, budgets: nextBudgets });
    }
    if (action === "summary") return Response.json({ summary: summarize(transactions), transactionCount: transactions.length });
    if (action === "analyze_finances") { const analysis = analyzeFinances(transactions, budgets, typeof body.period === "string" ? body.period : undefined); return Response.json({ summary: `${money(analysis.cashFlow.consumption)} consumption and ${money(analysis.cashFlow.netCashFlow)} net cash flow in ${analysis.period}.`, analysis }); }
    if (action === "generate_dashboard") {
      const analysis = analyzeFinances(transactions, budgets, typeof body.period === "string" ? body.period : undefined);
      let connection = await getSheetConnection(identity.userId);
      if (body.syncSheets === true) connection = connection ? await syncSpreadsheet(identity.userId) : await createSpreadsheet(identity.userId, body.name);
      return Response.json({ summary: `Generated the ${analysis.period} financial dashboard${body.syncSheets === true ? " and synchronized Google Sheets" : ""}.`, dashboard: analysis, connection });
    }
    if (action === "find_savings") { const opportunities = findSavingsOpportunities(transactions, typeof body.period === "string" ? body.period : undefined); return Response.json({ summary: opportunities.length ? `Found ${opportunities.length} evidence-backed savings opportunities.` : "No evidence-backed savings opportunities were found.", opportunities }); }
    if (action === "financial_health_report") { const report = financialHealthReport(transactions, budgets, typeof body.period === "string" ? body.period : undefined); return Response.json({ summary: `Financial health is ${report.score}/100 (${report.label}) for ${report.period}.`, report }); }
    if (action === "explain_spending_change") { const explanation = explainSpendingChange(transactions, typeof body.current === "string" ? body.current : undefined, typeof body.previous === "string" ? body.previous : undefined); return Response.json({ summary: explanation.consumptionChangePercent == null ? `No comparable consumption baseline exists for ${explanation.current}.` : `Consumption changed ${Math.abs(explanation.consumptionChangePercent).toFixed(0)}% ${explanation.consumptionChangePercent >= 0 ? "up" : "down"}.`, explanation }); }
    if (action === "why_is_budget_exceeded") { const explanation = explainBudgetExceeded(transactions, budgets, typeof body.category === "string" ? body.category : undefined, typeof body.period === "string" ? body.period : undefined); return Response.json({ summary: `${explanation.exceeded.length} budget${explanation.exceeded.length === 1 ? " is" : "s are"} over the limit in ${explanation.period}.`, explanation }); }
    if (action === "suggest_budget") { const suggestions = suggestBudgets(transactions, Number.isFinite(Number(body.bufferPercent)) ? Number(body.bufferPercent) : 10); return Response.json({ summary: `Built ${suggestions.length} category limit suggestions from trailing medians.`, suggestions }); }
    if (action === "find_cost_cutting") { const result = findCostCutting(transactions, typeof body.period === "string" ? body.period : undefined); return Response.json({ summary: `${money(result.totalMonthlyPotential)} in potential monthly reductions is supported by ledger evidence.`, ...result }); }
    if (action === "predict_month_end_spending") { const forecast = predictMonthEndSpending(transactions, typeof body.period === "string" ? body.period : undefined); return Response.json({ summary: `Projected month-end consumption is ${money(forecast.projectedConsumption)} with ${forecast.confidence} confidence.`, forecast }); }
    if (action === "financial_timeline") { const timeline = buildFinancialTimeline(transactions, budgets, Number.isFinite(Number(body.months)) ? Number(body.months) : 6); return Response.json({ summary: `Built a financial timeline with ${timeline.length} material events.`, timeline }); }
    if (action === "finance_graph") { const graph = buildFinanceGraph(transactions, budgets); return Response.json({ summary: `Derived ${graph.nodes.length} connected finance entities and ${graph.edges.length} evidence relationships.`, graph }); }
    if (action === "monthly_summary" || action === "spending_trends") return Response.json({ months: monthlySummaries(transactions) });
    if (action === "compare_months") return Response.json(compareMonths(transactions, typeof body.current === "string" ? body.current : undefined, typeof body.previous === "string" ? body.previous : undefined));
    if (action === "detect_subscriptions") return Response.json({ subscriptions: detectSubscriptions(transactions) });
    if (action === "find_duplicates") return Response.json({ duplicates: findDuplicateTransactions(transactions) });
    if (action === "detect_anomalies") return Response.json({ anomalies: detectAnomalies(transactions) });
    if (action === "budget_status") return Response.json({ budgets: budgetStatus(transactions, budgets, typeof body.period === "string" ? body.period : undefined) });
    if (action === "financial_health_score") return Response.json(financialHealthScore(transactions, budgets));
    if (action === "weekly_report") return Response.json(weeklyReport(transactions));
    if (action === "monthly_report") {
      const months = monthlySummaries(transactions);
      const period = typeof body.period === "string" ? body.period : months.at(-1)?.period || "";
      return Response.json({ period, summary: months.find((item) => item.period === period) || null, comparison: compareMonths(transactions, period), subscriptions: detectSubscriptions(transactions), anomalies: detectAnomalies(transactions), health: financialHealthScore(transactions, budgets) });
    }
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
    if (action === "sheet_share") return Response.json({ connection: await shareSpreadsheet(identity.userId, String(body.email || ""), body.notify !== false) });
    if (action === "sheet_unshare") return Response.json({ connection: await unshareSpreadsheet(identity.userId, String(body.email || "")) });
    if (action === "sheet_add_tab") return Response.json({ connection: await addSpreadsheetTab(identity.userId, body.name) });
    if (action === "sheet_delete_tab") return Response.json({ connection: await deleteSpreadsheetTab(identity.userId, body.name) });
    if (action === "sheet_read_range") return Response.json({ data: await readSpreadsheetRange(identity.userId, body.range) });
    if (action === "sheet_append_rows") return Response.json({ connection: await appendSpreadsheetRows(identity.userId, body.tab, body.values) });
    if (action === "sheet_update_range") return Response.json({ connection: await updateSpreadsheetRange(identity.userId, body.range, body.values) });
    if (action === "sheet_clear_range") return Response.json({ connection: await clearSpreadsheetRange(identity.userId, body.range) });
    if (action === "sheet_disconnect") { await disconnectSpreadsheet(identity.userId); return Response.json({ ok: true }); }
    if (action === "sheet_delete") { await deleteSpreadsheet(identity.userId); return Response.json({ ok: true }); }
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
    if (action === "report_settings_clear") { await getDb().delete(reportPreference).where(eq(reportPreference.userId, identity.userId)); return Response.json({ ok: true }); }
    return Response.json({ error: "Unknown action.", capabilities }, { status: 400 });
  } catch (error) { return sheetFailure(error, request); }
}
