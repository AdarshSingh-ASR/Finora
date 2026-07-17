import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { googleSheetConnection, userLedger } from "../db/schema";
import { getAuth } from "./auth";
import { analyzeFinances, buildCashFlow, buildFinancialTimeline, detectSubscriptions, findSavingsOpportunities, monthlySummaries, normalizeMerchant, predictMonthEndSpending, refineTransactionsForAnalysis } from "./finance";
import { planTransactionSheetSync, TRANSACTION_HEADER, transactionSheetRow } from "./sheet-sync-plan.mjs";
import type { StatementResult, Transaction } from "./types";

const SHEETS_API = "https://sheets.googleapis.com/v4";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const SHEET_TITLES = ["Transactions", "Monthly Summary", "Category Summary", "Merchant Summary", "Subscriptions", "Insights", "Cash Flow", "Spending Classes", "Financial Timeline", "Forecast & Savings", "Charts"] as const;

export class GoogleWorkspaceError extends Error {
  constructor(message: string, public status = 400, public code = "GOOGLE_API_ERROR") {
    super(message);
  }
}

async function googleToken(userId: string) {
  const { accessToken } = await getAuth()!.api.getAccessToken({ body: { providerId: "google", userId } });
  if (!accessToken) throw new GoogleWorkspaceError("Connect Google Sheets to continue.", 403, "GOOGLE_PERMISSION_REQUIRED");
  return accessToken;
}

async function googleRequest<T>(accessToken: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) {
    const nested = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
    const rawMessage = typeof nested?.message === "string" ? nested.message : `Google rejected the request (${response.status}).`;
    const permissionError = response.status === 401 || response.status === 403;
    const apiDisabled = /has not been used|is disabled|accessNotConfigured/i.test(rawMessage);
    const message = apiDisabled
      ? "Enable the required Google API for Finora's Google Cloud project, then try again."
      : permissionError ? "Google Sheets permission is missing or expired. Reconnect Google Sheets and try again." : rawMessage;
    if (apiDisabled) throw new GoogleWorkspaceError(message, 503, "GOOGLE_API_DISABLED");
    throw new GoogleWorkspaceError(message, permissionError ? 403 : response.status, permissionError ? "GOOGLE_PERMISSION_REQUIRED" : "GOOGLE_API_ERROR");
  }
  return payload as T;
}

function cleanName(value: unknown, fallback = "Finora Financial Dashboard") {
  const name = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f]/g, "") : "";
  return name.slice(0, 120) || fallback;
}

function groupedRows(transactions: Transaction[], keyFor: (transaction: Transaction) => string) {
  const groups = transactions.filter((transaction) => transaction.type === "debit").reduce<Record<string, { amount: number; count: number }>>((acc, transaction) => {
    const key = keyFor(transaction) || "Unknown";
    const current = acc[key] || { amount: 0, count: 0 };
    acc[key] = { amount: current.amount + transaction.amount, count: current.count + 1 };
    return acc;
  }, {});
  return Object.entries(groups).sort((a, b) => b[1].amount - a[1].amount).map(([name, value]) => [name, value.amount, value.count]);
}

function workbookValues(statement: StatementResult) {
  const refinedTransactions = refineTransactionsForAnalysis(statement.transactions);
  const intelligence = analyzeFinances(refinedTransactions, []);
  const timeline = buildFinancialTimeline(refinedTransactions, [], 6);
  const forecast = predictMonthEndSpending(refinedTransactions);
  const savings = findSavingsOpportunities(refinedTransactions);
  const transactions = [TRANSACTION_HEADER, ...refinedTransactions.map(transactionSheetRow)];
  const monthly = [["Period", "Income", "Consumption", "Transfers & investments", "Net cash flow", "Savings rate", "Transfers", "Investment contributions"], ...monthlySummaries(refinedTransactions).map((item) => {
    const cashFlow = buildCashFlow(refinedTransactions, item.period);
    return [item.period, item.income, item.spend, item.transfers, item.saved, Math.round(item.savingsRate * 100) / 100, cashFlow.transfers, cashFlow.investmentContributions];
  })];
  const categories = [["Category", "Amount", "Transactions"], ...groupedRows(refinedTransactions.filter((transaction) => !["Transfers", "Investment"].includes(transaction.category)), (transaction) => transaction.category)];
  const merchants = [["Merchant", "Amount", "Transactions"], ...groupedRows(refinedTransactions.filter((transaction) => !["Transfers", "Investment"].includes(transaction.category)), (transaction) => normalizeMerchant(transaction.merchant || transaction.description))];
  const detectedSubscriptions = detectSubscriptions(refinedTransactions);
  const subscriptions = [["Merchant", "Monthly cost", "Annual cost", "Occurrences", "Estimated renewal", "Confidence"], ...detectedSubscriptions.map((item) => [
    item.merchant, item.monthlyCost, item.annualCost, item.occurrences, item.estimatedRenewalDate, Math.round(item.confidence * 100) / 100,
  ])];
  const groundedInsights = [
    intelligence.byCategory[0] ? `${intelligence.byCategory[0].category} is the largest consumption area at ${intelligence.byCategory[0].amount.toFixed(0)}, representing ${intelligence.byCategory[0].share.toFixed(1)}% of consumption.` : "No consumption spending was detected in the selected period.",
    intelligence.topMerchants[0] ? `${intelligence.topMerchants[0].merchant} is the leading consumption merchant at ${intelligence.topMerchants[0].amount.toFixed(0)} across ${intelligence.topMerchants[0].count} payment(s).` : "No consumption merchant was available for ranking.",
    detectedSubscriptions.length ? `${detectedSubscriptions.length} recurring expense(s) total about ${detectedSubscriptions.reduce((total, item) => total + item.monthlyCost, 0).toFixed(0)} per month; the largest is ${detectedSubscriptions[0].merchant}.` : "No reliable recurring expense cadence was detected yet.",
    intelligence.largestTransaction ? `Notable outflow: ${normalizeMerchant(intelligence.largestTransaction.merchant || intelligence.largestTransaction.description)} at ${intelligence.largestTransaction.amount.toFixed(0)} on ${intelligence.largestTransaction.date.slice(0, 10)} (${intelligence.largestTransaction.category}).` : "No notable outflow was detected.",
    ...intelligence.anomalies.slice(0, 2).map((item) => `${item.title}: ${item.detail}`),
  ];
  const insights = [["Finora insight"], ...groundedInsights.map((insight) => [insight])];
  const cashFlow = [["Metric", "Value", "Period"], ["Income", intelligence.cashFlow.income, intelligence.period], ["Consumption", intelligence.cashFlow.consumption, intelligence.period], ["Transfers", intelligence.cashFlow.transfers, intelligence.period], ["Investment contributions", intelligence.cashFlow.investmentContributions, intelligence.period], ["Total outflow", intelligence.cashFlow.totalOutflow, intelligence.period], ["Net cash flow", intelligence.cashFlow.netCashFlow, intelligence.period], ["Savings rate", Math.round(intelligence.cashFlow.savingsRate * 100) / 100, intelligence.period]];
  const classes = [["Classification", "Amount", "Share of consumption"], ...Object.entries({ Fixed: intelligence.classificationTotals.fixed, Variable: intelligence.classificationTotals.variable, Essential: intelligence.classificationTotals.essential, Discretionary: intelligence.classificationTotals.discretionary, "Context-dependent": intelligence.classificationTotals.neutral }).map(([label, amount]) => [label, amount, intelligence.cashFlow.consumption ? Math.round(amount / intelligence.cashFlow.consumption * 10000) / 100 : 0]), ["Subscriptions", detectedSubscriptions.reduce((total, item) => total + item.monthlyCost, 0), Math.round(intelligence.classificationTotals.subscriptionShare * 100) / 100]];
  const timelineRows = [["Period", "Event", "Detail", "Type", "Significance", "Amount", "Change percent"], ...timeline.map((item) => [item.period, item.title, item.detail, item.type, item.significance, item.amount || "", item.changePercent == null ? "" : Math.round(item.changePercent * 100) / 100])];
  const forecastRows = [["Month-end forecast", "Value", "Detail"], ["Period", forecast.period, forecast.asOfDate], ["Actual consumption", forecast.actualConsumption, "Observed so far"], ["Projected consumption", forecast.projectedConsumption, `${forecast.confidence} confidence`], ["Projected total outflow", forecast.projectedTotalOutflow, "Includes transfers and investments"], ["Projected net cash flow", forecast.projectedNetCashFlow, forecast.explanation], ["Recurring still expected", forecast.recurringStillExpected, "Included in projection"], [], ["Savings opportunity", "Monthly potential", "Evidence"], ...savings.map((item) => [item.title, item.monthlyPotential, item.detail])];
  return { Transactions: transactions, "Monthly Summary": monthly, "Category Summary": categories, "Merchant Summary": merchants, Subscriptions: subscriptions, Insights: insights, "Cash Flow": cashFlow, "Spending Classes": classes, "Financial Timeline": timelineRows, "Forecast & Savings": forecastRows, Charts: [["Finora charts"], ["Charts refresh whenever you sync this workbook."]] };
}

type SheetMeta = { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } }; charts?: Array<{ chartId: number }> };

async function spreadsheetMetadata(accessToken: string, spreadsheetId: string) {
  return googleRequest<{ properties?: { title?: string }; spreadsheetUrl?: string; sheets?: SheetMeta[] }>(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=properties(title),spreadsheetUrl,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),charts(chartId))`);
}

async function ensureSheets(accessToken: string, spreadsheetId: string) {
  let metadata = await spreadsheetMetadata(accessToken, spreadsheetId);
  const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties.title));
  const missing = SHEET_TITLES.filter((title) => !existing.has(title));
  if (missing.length) {
    await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    });
    metadata = await spreadsheetMetadata(accessToken, spreadsheetId);
  }
  return metadata;
}

async function syncTransactionSheet(accessToken: string, spreadsheetId: string, sheetId: number, transactions: Transaction[]) {
  const existing = await googleRequest<{ values?: unknown[][] }>(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("'Transactions'!A2:J")}?majorDimension=ROWS`);
  const plan = planTransactionSheetSync(existing.values || [], transactions);
  const valueUpdates = [
    { range: "'Transactions'!A1:J1", majorDimension: "ROWS", values: [TRANSACTION_HEADER] },
    ...plan.updates.map((item) => ({ range: `'Transactions'!A${item.rowNumber}:J${item.rowNumber}`, majorDimension: "ROWS", values: [item.values] })),
  ];
  if (valueUpdates.length) await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: valueUpdates }),
  });
  if (plan.appends.length) await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("'Transactions'!A:J")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: plan.appends }),
  });
  if (plan.deleteRowNumbers.length) await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST", body: JSON.stringify({ requests: plan.deleteRowNumbers.map((rowNumber) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber } } })) }),
  });
  return plan;
}

async function writeWorkbook(accessToken: string, spreadsheetId: string, statement: StatementResult) {
  const values = workbookValues(statement);
  const metadata = await ensureSheets(accessToken, spreadsheetId);
  const byTitle = new Map((metadata.sheets || []).map((sheet) => [sheet.properties.title, sheet]));

  const transactionsSheet = byTitle.get("Transactions");
  if (!transactionsSheet) throw new GoogleWorkspaceError("The Transactions sheet could not be created.", 502);
  await syncTransactionSheet(accessToken, spreadsheetId, transactionsSheet.properties.sheetId, refineTransactionsForAnalysis(statement.transactions));

  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
    method: "POST", body: JSON.stringify({ ranges: SHEET_TITLES.filter((title) => title !== "Transactions").map((title) => `'${title}'`) }),
  });
  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: Object.entries(values).filter(([title]) => title !== "Transactions").map(([title, rows]) => ({ range: `'${title}'!A1`, majorDimension: "ROWS", values: rows })) }),
  });

  const requests: Record<string, unknown>[] = [];
  for (const title of SHEET_TITLES) {
    const sheet = byTitle.get(title);
    if (!sheet) continue;
    requests.push(
      { updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
      { repeatCell: { range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: .06, green: .20, blue: .16 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { autoResizeDimensions: { dimensions: { sheetId: sheet.properties.sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: title === "Transactions" ? 10 : title === "Financial Timeline" ? 7 : 6 } } },
    );
  }

  const chartsSheet = byTitle.get("Charts");
  const monthlySheet = byTitle.get("Monthly Summary");
  const categorySheet = byTitle.get("Category Summary");
  const classSheet = byTitle.get("Spending Classes");
  for (const chart of chartsSheet?.charts || []) requests.push({ deleteEmbeddedObject: { objectId: chart.chartId } });
  const monthlyRows = values["Monthly Summary"].length;
  if (chartsSheet && monthlySheet && monthlyRows > 1) requests.push({ addChart: { chart: {
    spec: { title: "Income and outflow by month", basicChart: { chartType: "LINE", legendPosition: "BOTTOM_LEGEND", headerCount: 1,
      domains: [{ domain: { sourceRange: { sources: [{ sheetId: monthlySheet.properties.sheetId, startRowIndex: 0, endRowIndex: monthlyRows, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
      series: [1, 2, 3].map((column) => ({ series: { sourceRange: { sources: [{ sheetId: monthlySheet.properties.sheetId, startRowIndex: 0, endRowIndex: monthlyRows, startColumnIndex: column, endColumnIndex: column + 1 }] } } })),
    } }, position: { overlayPosition: { anchorCell: { sheetId: chartsSheet.properties.sheetId, rowIndex: 2, columnIndex: 0 }, widthPixels: 720, heightPixels: 330 } },
  } } });
  const categoryRows = values["Category Summary"].length;
  if (chartsSheet && categorySheet && categoryRows > 1) requests.push({ addChart: { chart: {
    spec: { title: "Outflow by category", basicChart: { chartType: "BAR", legendPosition: "NO_LEGEND", headerCount: 1,
      domains: [{ domain: { sourceRange: { sources: [{ sheetId: categorySheet.properties.sheetId, startRowIndex: 0, endRowIndex: categoryRows, startColumnIndex: 0, endColumnIndex: 1 }] } } }],
      series: [{ series: { sourceRange: { sources: [{ sheetId: categorySheet.properties.sheetId, startRowIndex: 0, endRowIndex: categoryRows, startColumnIndex: 1, endColumnIndex: 2 }] } } }],
    } }, position: { overlayPosition: { anchorCell: { sheetId: chartsSheet.properties.sheetId, rowIndex: 21, columnIndex: 0 }, widthPixels: 720, heightPixels: 360 } },
  } } });
  const classRows = values["Spending Classes"].length;
  if (chartsSheet && classSheet && classRows > 1) requests.push({ addChart: { chart: {
    spec: { title: "Fixed versus variable spending", pieChart: { legendPosition: "RIGHT_LEGEND", domain: { sourceRange: { sources: [{ sheetId: classSheet.properties.sheetId, startRowIndex: 1, endRowIndex: Math.min(3, classRows), startColumnIndex: 0, endColumnIndex: 1 }] } }, series: { sourceRange: { sources: [{ sheetId: classSheet.properties.sheetId, startRowIndex: 1, endRowIndex: Math.min(3, classRows), startColumnIndex: 1, endColumnIndex: 2 }] } } } },
    position: { overlayPosition: { anchorCell: { sheetId: chartsSheet.properties.sheetId, rowIndex: 2, columnIndex: 10 }, widthPixels: 520, heightPixels: 330 } },
  } } });

  if (requests.length) await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  return metadata;
}

async function ledgerFor(userId: string) {
  const [ledger] = await getDb().select().from(userLedger).where(eq(userLedger.userId, userId)).limit(1);
  if (!ledger) throw new GoogleWorkspaceError("Import a statement before syncing Google Sheets.", 400, "LEDGER_REQUIRED");
  return { statement: JSON.parse(ledger.statementJson) as StatementResult, updatedAt: ledger.updatedAt };
}

async function saveConnection(userId: string, input: { spreadsheetId: string; spreadsheetUrl: string; name: string; folderId?: string | null }) {
  const db = getDb();
  const now = new Date();
  await db.insert(googleSheetConnection).values({ userId, spreadsheetId: input.spreadsheetId, spreadsheetUrl: input.spreadsheetUrl, name: input.name, folderId: input.folderId || null, createdAt: now, updatedAt: now, lastSyncedAt: now })
    .onConflictDoUpdate({ target: googleSheetConnection.userId, set: { spreadsheetId: input.spreadsheetId, spreadsheetUrl: input.spreadsheetUrl, name: input.name, folderId: input.folderId || null, updatedAt: now, lastSyncedAt: now } });
  return { ...input, lastSyncedAt: now };
}

export async function getSheetConnection(userId: string) {
  const db = getDb();
  const [connection] = await db.select().from(googleSheetConnection).where(eq(googleSheetConnection.userId, userId)).limit(1);
  const [ledger] = await db.select({ updatedAt: userLedger.updatedAt }).from(userLedger).where(eq(userLedger.userId, userId)).limit(1);
  return connection ? { ...connection, stale: Boolean(ledger && connection.lastSyncedAt < ledger.updatedAt) } : null;
}

export async function inspectSpreadsheet(userId: string) {
  const connection = connectedWorkbook(await getSheetConnection(userId));
  const accessToken = await googleToken(userId);
  const metadata = await spreadsheetMetadata(accessToken, connection.spreadsheetId);
  const ranges = ["'Transactions'!A1:J5", "'Monthly Summary'!A1:H5", "'Category Summary'!A1:C8", "'Merchant Summary'!A1:C8", "'Subscriptions'!A1:F8", "'Insights'!A1:A5", "'Cash Flow'!A1:C10", "'Spending Classes'!A1:C10", "'Financial Timeline'!A1:G8", "'Forecast & Savings'!A1:C12", "'Charts'!A1:B3"];
  const params = new URLSearchParams();
  for (const range of ranges) params.append("ranges", range);
  params.set("majorDimension", "ROWS");
  params.set("valueRenderOption", "FORMATTED_VALUE");
  const values = await googleRequest<{ valueRanges?: Array<{ range?: string; values?: unknown[][] }> }>(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}/values:batchGet?${params}`);
  return {
    spreadsheetId: connection.spreadsheetId,
    spreadsheetUrl: metadata.spreadsheetUrl || connection.spreadsheetUrl,
    name: metadata.properties?.title || connection.name,
    sheets: (metadata.sheets || []).map((sheet) => ({
      title: sheet.properties.title,
      rowCount: sheet.properties.gridProperties?.rowCount || 0,
      columnCount: sheet.properties.gridProperties?.columnCount || 0,
      chartCount: sheet.charts?.length || 0,
    })),
    samples: (values.valueRanges || []).map((range) => ({ range: range.range, values: range.values || [] })),
  };
}

export async function listSpreadsheets(userId: string, search = "") {
  const accessToken = await googleToken(userId);
  const safeSearch = search.trim().slice(0, 80).replaceAll("'", "\\'");
  const query = [`mimeType='application/vnd.google-apps.spreadsheet'`, "trashed=false", safeSearch ? `name contains '${safeSearch}'` : ""].filter(Boolean).join(" and ");
  const params = new URLSearchParams({ q: query, orderBy: "modifiedTime desc", pageSize: "40", fields: "files(id,name,webViewLink,modifiedTime,parents)" });
  const result = await googleRequest<{ files?: Array<{ id: string; name: string; webViewLink?: string; modifiedTime?: string; parents?: string[] }> }>(accessToken, `${DRIVE_API}/files?${params}`);
  return result.files || [];
}

export async function createSpreadsheet(userId: string, requestedName?: unknown, statementOverride?: StatementResult) {
  const accessToken = await googleToken(userId);
  const name = cleanName(requestedName);
  const created = await googleRequest<{ spreadsheetId: string; spreadsheetUrl: string; properties?: { title?: string } }>(accessToken, `${SHEETS_API}/spreadsheets?fields=spreadsheetId,spreadsheetUrl,properties(title)`, {
    method: "POST", body: JSON.stringify({ properties: { title: name }, sheets: SHEET_TITLES.map((title) => ({ properties: { title } })) }),
  });
  const statement = statementOverride || (await ledgerFor(userId)).statement;
  await writeWorkbook(accessToken, created.spreadsheetId, statement);
  return saveConnection(userId, { spreadsheetId: created.spreadsheetId, spreadsheetUrl: created.spreadsheetUrl, name: created.properties?.title || name });
}

export async function connectSpreadsheet(userId: string, spreadsheetId: string) {
  const accessToken = await googleToken(userId);
  const metadata = await spreadsheetMetadata(accessToken, spreadsheetId);
  const { statement } = await ledgerFor(userId);
  await writeWorkbook(accessToken, spreadsheetId, statement);
  return saveConnection(userId, { spreadsheetId, spreadsheetUrl: metadata.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, name: metadata.properties?.title || "Finora Financial Dashboard" });
}

export async function syncSpreadsheet(userId: string, statementOverride?: StatementResult) {
  const connection = await getSheetConnection(userId);
  if (!connection) throw new GoogleWorkspaceError("Create or select a spreadsheet first.", 404, "SHEET_CONNECTION_REQUIRED");
  const accessToken = await googleToken(userId);
  const statement = statementOverride || (await ledgerFor(userId)).statement;
  const metadata = await writeWorkbook(accessToken, connection.spreadsheetId, statement);
  return saveConnection(userId, { spreadsheetId: connection.spreadsheetId, spreadsheetUrl: metadata.spreadsheetUrl || connection.spreadsheetUrl, name: metadata.properties?.title || connection.name, folderId: connection.folderId });
}

export async function renameSpreadsheet(userId: string, requestedName: unknown) {
  const connection = await getSheetConnection(userId);
  if (!connection) throw new GoogleWorkspaceError("Connect a spreadsheet first.", 404);
  const accessToken = await googleToken(userId);
  const name = cleanName(requestedName, connection.name);
  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ updateSpreadsheetProperties: { properties: { title: name }, fields: "title" } }] }) });
  return saveConnection(userId, { spreadsheetId: connection.spreadsheetId, spreadsheetUrl: connection.spreadsheetUrl, name, folderId: connection.folderId });
}

export async function copySpreadsheet(userId: string, requestedName: unknown) {
  const connection = await getSheetConnection(userId);
  if (!connection) throw new GoogleWorkspaceError("Connect a spreadsheet first.", 404);
  const accessToken = await googleToken(userId);
  const name = cleanName(requestedName, `${connection.name} copy`);
  const copy = await googleRequest<{ id: string; name: string; webViewLink?: string; parents?: string[] }>(accessToken, `${DRIVE_API}/files/${encodeURIComponent(connection.spreadsheetId)}/copy?fields=id,name,webViewLink,parents`, { method: "POST", body: JSON.stringify({ name }) });
  return saveConnection(userId, { spreadsheetId: copy.id, spreadsheetUrl: copy.webViewLink || `https://docs.google.com/spreadsheets/d/${copy.id}/edit`, name: copy.name, folderId: copy.parents?.[0] || null });
}

export async function moveSpreadsheet(userId: string, folderId: string) {
  const connection = await getSheetConnection(userId);
  if (!connection) throw new GoogleWorkspaceError("Connect a spreadsheet first.", 404);
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) throw new GoogleWorkspaceError("Enter a valid Google Drive folder ID.");
  const accessToken = await googleToken(userId);
  const current = await googleRequest<{ parents?: string[] }>(accessToken, `${DRIVE_API}/files/${encodeURIComponent(connection.spreadsheetId)}?fields=parents`);
  const params = new URLSearchParams({ addParents: folderId, fields: "id,parents", ...(current.parents?.length ? { removeParents: current.parents.join(",") } : {}) });
  await googleRequest(accessToken, `${DRIVE_API}/files/${encodeURIComponent(connection.spreadsheetId)}?${params}`, { method: "PATCH", body: "{}" });
  return saveConnection(userId, { spreadsheetId: connection.spreadsheetId, spreadsheetUrl: connection.spreadsheetUrl, name: connection.name, folderId });
}

export async function shareSpreadsheet(userId: string, email: string, sendNotificationEmail = true) {
  const connection = await getSheetConnection(userId);
  if (!connection) throw new GoogleWorkspaceError("Connect a spreadsheet first.", 404);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GoogleWorkspaceError("Enter a valid email address.");
  const accessToken = await googleToken(userId);
  const params = new URLSearchParams({ sendNotificationEmail: String(sendNotificationEmail), fields: "id" });
  await googleRequest(accessToken, `${DRIVE_API}/files/${encodeURIComponent(connection.spreadsheetId)}/permissions?${params}`, { method: "POST", body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }) });
  return connection;
}

export async function unshareSpreadsheet(userId: string, email: string) {
  const connection = await getSheetConnection(userId);
  if (!connection) throw new GoogleWorkspaceError("Connect a spreadsheet first.", 404);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GoogleWorkspaceError("Enter a valid email address.");
  const accessToken = await googleToken(userId);
  const permissions = await googleRequest<{ permissions?: Array<{ id: string; emailAddress?: string; role?: string }> }>(accessToken, `${DRIVE_API}/files/${encodeURIComponent(connection.spreadsheetId)}/permissions?fields=permissions(id,emailAddress,role)`);
  const permission = permissions.permissions?.find((item) => item.emailAddress?.toLowerCase() === email.toLowerCase());
  if (!permission) throw new GoogleWorkspaceError("That email does not currently have direct access to this workbook.", 404);
  if (permission.role === "owner") throw new GoogleWorkspaceError("The workbook owner cannot be removed.");
  await googleRequest(accessToken, `${DRIVE_API}/files/${encodeURIComponent(connection.spreadsheetId)}/permissions/${encodeURIComponent(permission.id)}`, { method: "DELETE" });
  return connection;
}

export async function disconnectSpreadsheet(userId: string) {
  await getDb().delete(googleSheetConnection).where(eq(googleSheetConnection.userId, userId));
}

export async function deleteSpreadsheet(userId: string) {
  const connection = await getSheetConnection(userId);
  if (!connection) return;
  const accessToken = await googleToken(userId);
  await googleRequest(accessToken, `${DRIVE_API}/files/${encodeURIComponent(connection.spreadsheetId)}`, { method: "DELETE" });
  await disconnectSpreadsheet(userId);
}

function cleanTabName(value: unknown) {
  const tab = typeof value === "string" ? value.trim() : "";
  if (!tab || tab.length > 100 || /[\[\]:*?\\/]/.test(tab)) throw new GoogleWorkspaceError("Enter a valid sheet tab name.");
  return tab;
}

function connectedWorkbook(connection: Awaited<ReturnType<typeof getSheetConnection>>) {
  if (!connection) throw new GoogleWorkspaceError("Connect a spreadsheet first.", 404, "SHEET_CONNECTION_REQUIRED");
  return connection;
}

export async function addSpreadsheetTab(userId: string, requestedName: unknown) {
  const connection = connectedWorkbook(await getSheetConnection(userId));
  const accessToken = await googleToken(userId);
  const title = cleanTabName(requestedName);
  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) });
  return connection;
}

export async function deleteSpreadsheetTab(userId: string, requestedName: unknown) {
  const connection = connectedWorkbook(await getSheetConnection(userId));
  const accessToken = await googleToken(userId);
  const title = cleanTabName(requestedName);
  const metadata = await spreadsheetMetadata(accessToken, connection.spreadsheetId);
  const sheet = metadata.sheets?.find((item) => item.properties.title.toLowerCase() === title.toLowerCase());
  if (!sheet) throw new GoogleWorkspaceError(`The “${title}” tab was not found.`, 404);
  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: sheet.properties.sheetId } }] }) });
  return connection;
}

function parseRows(input: unknown) {
  let rows: unknown = input;
  if (typeof input === "string") {
    try { rows = JSON.parse(input); } catch { throw new GoogleWorkspaceError("Sheet values must be valid tabular JSON."); }
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 200 || rows.some((row) => !Array.isArray(row) || row.length > 50)) throw new GoogleWorkspaceError("Provide between 1 and 200 rows with at most 50 columns each.");
  return rows.map((row) => (row as unknown[]).map((cell) => typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean" ? cell : String(cell ?? "")));
}

function cleanRange(value: unknown) {
  const range = typeof value === "string" ? value.trim() : "";
  if (!range || range.length > 120 || !/^[^!]{1,100}![A-Za-z]{1,3}\d*(?::[A-Za-z]{1,3}\d*)?$/.test(range.replaceAll("'", ""))) throw new GoogleWorkspaceError("Enter a range such as Transactions!A2:C20.");
  return range;
}

export async function readSpreadsheetRange(userId: string, requestedRange: unknown) {
  const connection = connectedWorkbook(await getSheetConnection(userId));
  const accessToken = await googleToken(userId);
  const range = cleanRange(requestedRange);
  const params = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" });
  const result = await googleRequest<{ range?: string; values?: unknown[][] }>(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}/values/${encodeURIComponent(range)}?${params}`);
  return { range: result.range || range, values: result.values || [] };
}

export async function appendSpreadsheetRows(userId: string, requestedTab: unknown, input: unknown) {
  const connection = connectedWorkbook(await getSheetConnection(userId));
  const accessToken = await googleToken(userId);
  const tab = cleanTabName(requestedTab);
  const rows = parseRows(input);
  const range = `'${tab.replaceAll("'", "''")}'!A1`;
  const params = new URLSearchParams({ valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" });
  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}/values/${encodeURIComponent(range)}:append?${params}`, { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: rows }) });
  return connection;
}

export async function updateSpreadsheetRange(userId: string, requestedRange: unknown, input: unknown) {
  const connection = connectedWorkbook(await getSheetConnection(userId));
  const accessToken = await googleToken(userId);
  const range = cleanRange(requestedRange);
  const rows = parseRows(input);
  const params = new URLSearchParams({ valueInputOption: "USER_ENTERED" });
  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}/values/${encodeURIComponent(range)}?${params}`, { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values: rows }) });
  return connection;
}

export async function clearSpreadsheetRange(userId: string, requestedRange: unknown) {
  const connection = connectedWorkbook(await getSheetConnection(userId));
  const accessToken = await googleToken(userId);
  const range = cleanRange(requestedRange);
  await googleRequest(accessToken, `${SHEETS_API}/spreadsheets/${encodeURIComponent(connection.spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, { method: "POST", body: "{}" });
  return connection;
}

export const googleSheetScope = "https://www.googleapis.com/auth/drive.file";
