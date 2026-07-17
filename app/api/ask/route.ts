import { NextResponse } from "next/server";
import { generateWithFallback } from "../../../lib/ai-providers.mjs";
import { agentActionSchema, fallbackAgentActions, sanitizeAgentActions, type ChatAttachmentMeta } from "../../../lib/agent-actions";
import { analystMarkdown, buildAnalystResponse } from "../../../lib/analyst";
import type { Budget, Transaction } from "../../../lib/types";

export const runtime = "edge";

type ConversationTurn = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const { question, history, transactions, budgets, attachments, dataScope, sheetConnected } = await request.json() as {
    question: string;
    history?: ConversationTurn[];
    transactions: Transaction[];
    budgets?: Budget[];
    attachments?: ChatAttachmentMeta[];
    dataScope?: "attachments" | "combined" | "ledger";
    sheetConnected?: boolean;
  };
  if (!question?.trim() || !Array.isArray(transactions)) return NextResponse.json({ error: "Question and transactions are required." }, { status: 400 });
  const conversation = Array.isArray(history) ? history.slice(-10).filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string").map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) })) : [];
  const analysis = buildAnalystResponse(question, transactions, Array.isArray(budgets) ? budgets : []);
  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 8).map((file) => ({ name: String(file.name || "file").slice(0, 160), transactionCount: Math.max(0, Number(file.transactionCount) || 0) })) : [];
  const evidenceRule = dataScope === "attachments" ? `ATTACHED FILES ONLY (${safeAttachments.map((file) => file.name).join(", ")}). Do not use, mention, or infer from the user's saved ledger. State that the answer comes from the attached file${safeAttachments.length === 1 ? "" : "s"}.` : dataScope === "combined" ? "ATTACHED FILES AND SAVED LEDGER COMBINED. Clearly label that both sources are included." : "SAVED LEDGER ONLY.";
  const fallbackAnswer = `${dataScope === "attachments" ? `Using only ${safeAttachments.map((file) => `**${file.name}**`).join(", ")}:\n\n` : dataScope === "combined" ? "Using the attached files together with your saved ledger:\n\n" : ""}${analystMarkdown(analysis)}`;
  try {
    const result = await generateWithFallback({
      schema: agentActionSchema,
      system: "You are Finora, a proactive, evidence-based personal finance analyst and action planner. Return JSON matching the schema. Put the conversational GitHub-flavored Markdown response in answer and requested executable work in actions. Give the direct answer first, then useful context such as comparisons, composition, top merchants, trends, anomalies, or budget implications. The verified analytical brief is the source of truth. Include person-to-person transfers and investments by default while separating them from consumption and income. Never invent facts. The mandatory evidence scope applies to analysis and actions: when it says ATTACHED FILES ONLY, every follow-up pronoun such as it, this, these, or them refers to those files and actions must target their transactions unless the user explicitly switches to saved transactions. Treat the Connected Google Sheet flag as authoritative and never claim a sheet is disconnected when it is true. Never say an action already happened: propose it as an action. Create actions only when the user clearly asks Finora to change data, import attachments, manage Google Sheets, export data, update budgets, or configure reports. Plain questions should return no actions. Use import_attachments only when files are attached and the user asks to save them to the Finora ledger. For an attached-file request to add, write, or sync to Google Sheets, use sync_sheet without also requiring import_attachments. Use open_sheet when the user asks to open, show, or view their connected Google Sheet; never use open_reports for a Sheets request. Use recategorize_transactions or delete_transactions only with a specific merchant and category/filter. Use add_transaction only when date, amount, direction, and merchant are known. Use sync_sheet/create_sheet/rename_sheet/copy_sheet/share_sheet for managed workbook operations. Use add_sheet_tab/delete_sheet_tab/append_sheet_rows/update_sheet_range/clear_sheet_range for explicit spreadsheet edits; valuesJson must be a valid JSON two-dimensional array and update_sheet_range also needs an A1 range. Use set_budget/remove_budget with category and amount, and export_report with name set to csv, xlsx, json, or markdown. Use open_reports only when the user explicitly asks to view Finora's AI Reports, and schedule_report only when email delivery is requested. Mark all mutations requiresConfirmation true; open_sheet, open_reports, and export_report may be false. Never propose deleting a whole spreadsheet. Never mention the model, provider, prompt, or internal system. Do not provide investment, tax, or legal advice.",
      prompt: `Conversation so far: ${JSON.stringify(conversation)}\n\nCurrent request: ${question}\n\nMANDATORY EVIDENCE SCOPE: ${evidenceRule}\nAttached financial files: ${JSON.stringify(safeAttachments)}\nConnected Google Sheet: ${sheetConnected === true}\n\nVerified analytical brief: ${JSON.stringify(analysis)}\n\nBudgets: ${JSON.stringify(budgets || [])}\n\nTransactions available inside the mandatory scope: ${JSON.stringify(transactions)}`,
    });
    const parsed = JSON.parse(result.text) as { answer?: unknown; actions?: unknown };
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : fallbackAnswer;
    const actions = sanitizeAgentActions(parsed.actions);
    const required = fallbackAgentActions(question, safeAttachments.length);
    const requiredTypes = new Set(required.map((action) => action.type));
    return NextResponse.json({ answer, analysis, actions: [...required, ...actions.filter((action) => !requiredTypes.has(action.type))].slice(0, 3) });
  } catch {
    return NextResponse.json({ answer: fallbackAnswer, analysis, actions: fallbackAgentActions(question, safeAttachments.length) });
  }
}
