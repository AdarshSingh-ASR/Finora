import { getAuth } from "../../../lib/auth";
import {
  GoogleWorkspaceError, addSpreadsheetTab, appendSpreadsheetRows, clearSpreadsheetRange,
  connectSpreadsheet, copySpreadsheet, createSpreadsheet, deleteSpreadsheet, deleteSpreadsheetTab,
  disconnectSpreadsheet, getSheetConnection, listSpreadsheets, moveSpreadsheet, renameSpreadsheet,
  shareSpreadsheet, syncSpreadsheet, updateSpreadsheetRange,
} from "../../../lib/google-sheets";
import { categories } from "../../../lib/finance";
import type { Category, StatementResult, Transaction } from "../../../lib/types";

export const runtime = "edge";

async function currentUser(request: Request) {
  const session = await getAuth()!.api.getSession({ headers: request.headers });
  return session?.user || null;
}

function failure(error: unknown) {
  if (error instanceof GoogleWorkspaceError) return Response.json({ error: error.message, code: error.code, permissionRequired: error.code === "GOOGLE_PERMISSION_REQUIRED" }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Google Sheets request failed." }, { status: 400 });
}

function statementOverride(input: unknown): StatementResult | undefined {
  if (input == null) return undefined;
  if (!input || typeof input !== "object") throw new GoogleWorkspaceError("The attached statement is invalid.");
  const source = input as Record<string, unknown>;
  if (!Array.isArray(source.transactions) || !source.transactions.length || source.transactions.length > 10_000) throw new GoogleWorkspaceError("The attached statement has no usable transactions or is too large.");
  const transactions = source.transactions.flatMap<Transaction>((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const amount = Math.abs(Number(row.amount));
    const type = row.type === "credit" ? "credit" : row.type === "debit" ? "debit" : null;
    if (!type || !Number.isFinite(amount) || amount <= 0 || typeof row.date !== "string") return [];
    return [{
      id: typeof row.id === "string" ? row.id.slice(0, 100) : `sheet-transaction-${index}`, date: row.date.slice(0, 40),
      merchant: String(row.merchant || "Unknown merchant").slice(0, 240), description: String(row.description || row.merchant || "Transaction").slice(0, 1_000),
      amount, type, category: typeof row.category === "string" && categories.includes(row.category as Category) ? row.category as Category : "Miscellaneous",
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)), source: String(row.source || "Ask Finora attachment").slice(0, 180),
      explanation: String(row.explanation || "Categorized from the attached file.").slice(0, 500),
    }];
  });
  if (!transactions.length) throw new GoogleWorkspaceError("The attached statement has no usable transactions.");
  return {
    accountName: String(source.accountName || "Attached account").slice(0, 180), bankName: String(source.bankName || "Attached statement").slice(0, 180),
    period: String(source.period || "Attached statement").slice(0, 180), currency: String(source.currency || "INR").slice(0, 12), transactions,
    insights: Array.isArray(source.insights) ? source.insights.slice(0, 3).map((item) => String(item).slice(0, 500)) : [],
  };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const connection = await getSheetConnection(user.id);
    const files = url.searchParams.get("includeFiles") === "1" ? await listSpreadsheets(user.id, url.searchParams.get("search") || "") : undefined;
    return Response.json({ connection, files });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "sync";
    const scopedStatement = statementOverride(body.statement);
    let connection;
    if (action === "create") connection = await createSpreadsheet(user.id, body.name, scopedStatement);
    else if (action === "connect") {
      if (typeof body.spreadsheetId !== "string" || !/^[A-Za-z0-9_-]{20,}$/.test(body.spreadsheetId)) throw new GoogleWorkspaceError("Choose a valid Google spreadsheet.");
      connection = await connectSpreadsheet(user.id, body.spreadsheetId);
    } else if (action === "sync") connection = await syncSpreadsheet(user.id, scopedStatement);
    else if (action === "rename") connection = await renameSpreadsheet(user.id, body.name);
    else if (action === "copy") connection = await copySpreadsheet(user.id, body.name);
    else if (action === "move") {
      if (typeof body.folderId !== "string") throw new GoogleWorkspaceError("Enter a Google Drive folder ID.");
      connection = await moveSpreadsheet(user.id, body.folderId);
    } else if (action === "share") {
      if (typeof body.email !== "string") throw new GoogleWorkspaceError("Enter an email address.");
      connection = await shareSpreadsheet(user.id, body.email);
    } else if (action === "addTab") connection = await addSpreadsheetTab(user.id, body.name);
    else if (action === "deleteTab") connection = await deleteSpreadsheetTab(user.id, body.name);
    else if (action === "appendRows") connection = await appendSpreadsheetRows(user.id, body.tab, body.valuesJson);
    else if (action === "updateRange") connection = await updateSpreadsheetRange(user.id, body.range, body.valuesJson);
    else if (action === "clearRange") connection = await clearSpreadsheetRange(user.id, body.range);
    else throw new GoogleWorkspaceError("Unknown Google Sheets action.");
    return Response.json({ ok: true, connection });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const permanently = new URL(request.url).searchParams.get("permanent") === "1";
    if (permanently) await deleteSpreadsheet(user.id);
    else await disconnectSpreadsheet(user.id);
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
