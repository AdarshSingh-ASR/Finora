import { categories } from "./finance";
import type { Category } from "./types";

export const agentActionTypes = [
  "import_attachments", "recategorize_transactions", "delete_transactions", "add_transaction",
  "open_sheet", "sync_sheet", "create_sheet", "rename_sheet", "copy_sheet", "share_sheet",
  "add_sheet_tab", "delete_sheet_tab", "append_sheet_rows", "update_sheet_range", "clear_sheet_range",
  "set_budget", "remove_budget", "export_report", "open_reports", "schedule_report",
] as const;

export type AgentActionType = typeof agentActionTypes[number];
export type AgentActionStatus = "pending" | "running" | "completed" | "failed";
export type AgentActionPayload = {
  merchant: string;
  category: string;
  date: string;
  amount: number;
  direction: "debit" | "credit" | "";
  description: string;
  name: string;
  email: string;
  tab: string;
  range: string;
  valuesJson: string;
  frequency: "weekly" | "monthly" | "";
  timezone: string;
};

export type AgentAction = {
  id: string;
  type: AgentActionType;
  label: string;
  description: string;
  requiresConfirmation: boolean;
  payload: AgentActionPayload;
  status: AgentActionStatus;
  result?: string;
};

export type ChatAttachmentMeta = { id: string; name: string; size: number; transactionCount: number };

const blankPayload: AgentActionPayload = { merchant: "", category: "", date: "", amount: 0, direction: "", description: "", name: "", email: "", tab: "", range: "", valuesJson: "", frequency: "", timezone: "" };

export const agentActionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    actions: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          type: { type: "string", enum: [...agentActionTypes] },
          label: { type: "string" },
          description: { type: "string" },
          requiresConfirmation: { type: "boolean" },
          payload: {
            type: "object", additionalProperties: false,
            properties: {
              merchant: { type: "string" }, category: { type: "string" }, date: { type: "string" }, amount: { type: "number" },
              direction: { type: "string", enum: ["debit", "credit", ""] }, description: { type: "string" }, name: { type: "string" },
              email: { type: "string" }, tab: { type: "string" }, range: { type: "string" }, valuesJson: { type: "string" },
              frequency: { type: "string", enum: ["weekly", "monthly", ""] }, timezone: { type: "string" },
            },
            required: ["merchant", "category", "date", "amount", "direction", "description", "name", "email", "tab", "range", "valuesJson", "frequency", "timezone"],
          },
        },
        required: ["type", "label", "description", "requiresConfirmation", "payload"],
      },
    },
  },
  required: ["answer", "actions"],
} as const;

function safeString(value: unknown, length = 160) { return typeof value === "string" ? value.trim().slice(0, length) : ""; }

export function sanitizeAgentActions(input: unknown): AgentAction[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 3).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    if (!agentActionTypes.includes(source.type as AgentActionType)) return [];
    const raw = source.payload && typeof source.payload === "object" ? source.payload as Record<string, unknown> : {};
    const category = safeString(raw.category, 40);
    const payload: AgentActionPayload = {
      ...blankPayload,
      merchant: safeString(raw.merchant), category: categories.includes(category as Category) ? category : "", date: safeString(raw.date, 30),
      amount: Number.isFinite(Number(raw.amount)) ? Math.max(0, Number(raw.amount)) : 0,
      direction: raw.direction === "credit" ? "credit" : raw.direction === "debit" ? "debit" : "",
      description: safeString(raw.description, 500), name: safeString(raw.name, 120), email: safeString(raw.email, 200),
      tab: safeString(raw.tab, 100), range: safeString(raw.range, 120), valuesJson: safeString(raw.valuesJson, 12_000),
      frequency: raw.frequency === "monthly" ? "monthly" : raw.frequency === "weekly" ? "weekly" : "", timezone: safeString(raw.timezone, 80),
    };
    const status = source.status === "completed" || source.status === "failed" || source.status === "running" ? source.status : "pending";
    return [{ id: safeString(source.id, 100) || `action-${Date.now()}-${index}`, type: source.type as AgentActionType, label: safeString(source.label, 100) || "Finora action", description: safeString(source.description, 260), requiresConfirmation: source.requiresConfirmation !== false, payload, status, ...(safeString(source.result, 300) ? { result: safeString(source.result, 300) } : {}) }];
  });
}

export function fallbackAgentActions(question: string, attachmentCount: number): AgentAction[] {
  const lower = question.toLowerCase();
  const raw: Array<Partial<AgentAction> & { type: AgentActionType; payload?: Partial<AgentActionPayload> }> = [];
  const sheetIntent = /\b(sheet|sheets|spreadsheet|workbook)\b/.test(lower);
  if (sheetIntent && /\b(open|view|show|visit|go to)\b/.test(lower)) raw.push({ type: "open_sheet", label: "Open Google Sheet", description: "Open your connected Finora workbook.", requiresConfirmation: false });
  if (attachmentCount && !sheetIntent && /\b(import|add|save|merge|categorize)\b/.test(lower)) raw.push({ type: "import_attachments", label: "Add files to your ledger", description: `Import and categorize transactions from ${attachmentCount} attached file${attachmentCount === 1 ? "" : "s"}.` });
  if (sheetIntent && /\b(sync|update|upload|send|push|add|put|write)\b/.test(lower)) raw.push({ type: "sync_sheet", label: "Sync Google Sheets", description: attachmentCount ? `Write the ${attachmentCount} attached file${attachmentCount === 1 ? "" : "s"} to your connected Finora workbook.` : "Update the connected workbook with the latest Finora ledger." });
  if (/\b(create|make|new)\b.*\b(sheet|spreadsheet|workbook)\b/.test(lower)) raw.push({ type: "create_sheet", label: "Create financial workbook", description: "Create and connect a new Finora Google Sheets dashboard." });
  if (/\b(report|review|summary)\b/.test(lower)) raw.push({ type: "open_reports", label: "Open AI Reports", description: "Open your weekly and monthly financial report workspace.", requiresConfirmation: false });
  return sanitizeAgentActions(raw.map((item) => ({ ...item, requiresConfirmation: item.requiresConfirmation ?? true, payload: { ...blankPayload, ...item.payload } })));
}
