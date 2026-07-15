#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.FINORA_DATA_DIR || ".finora");
const LEDGER_PATH = path.join(DATA_DIR, "ledger.json");
const categories = ["Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities", "Health", "Entertainment", "Travel", "Income", "Transfers", "Other"];

function categoryFor(description, credit = false) {
  if (credit) return "Income";
  const s = description.toLowerCase();
  if (/swiggy|zomato|blinkit|zepto|restaurant|cafe|coffee|food|grocery/.test(s)) return "Food & Dining";
  if (/rent|housing|maintenance/.test(s)) return "Housing";
  if (/uber|ola|rapido|metro|fuel|petrol|irctc/.test(s)) return "Transport";
  if (/amazon|flipkart|myntra|ajio|retail/.test(s)) return "Shopping";
  if (/electric|bescom|airtel|jio|broadband|water|gas|bbps/.test(s)) return "Bills & Utilities";
  if (/hospital|pharmacy|medical|cult|gym|health/.test(s)) return "Health";
  if (/netflix|spotify|cinema|bookmyshow|hotstar/.test(s)) return "Entertainment";
  if (/airline|indigo|hotel|makemytrip|booking/.test(s)) return "Travel";
  if (/transfer|imps|ach|sip|fund|upi\/[^/]+\s[^/]+\//.test(s)) return "Transfers";
  return "Other";
}

function splitCsv(line, delimiter) {
  const cells = []; let value = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim()); return cells;
}

function parseCsv(text, source) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const delimiter = lines[0]?.includes("\t") ? "\t" : lines[0]?.includes(";") ? ";" : ",";
  const headers = splitCsv(lines[0] || "", delimiter).map((h) => h.toLowerCase());
  const find = (...names) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const date = find("date"), description = find("description", "narration", "details", "merchant", "particular");
  const debit = find("debit", "withdrawal"), credit = find("credit", "deposit"), amount = find("amount"), type = find("type", "dr/cr");
  if (description < 0 || (debit < 0 && credit < 0 && amount < 0)) throw new Error("Could not identify the statement columns.");
  const number = (value = "") => Number(value.replace(/[^0-9.-]/g, "")) || 0;
  return lines.slice(1).map((line, index) => {
    const row = splitCsv(line, delimiter); const creditAmount = credit >= 0 ? number(row[credit]) : 0; const debitAmount = debit >= 0 ? number(row[debit]) : 0;
    const isCredit = creditAmount > 0 || /cr|credit|deposit/i.test(row[type] || "");
    const raw = row[description] || "Unknown transaction";
    return { id: `txn-${Date.now()}-${index + 1}`, date: row[date] || new Date().toISOString().slice(0, 10), merchant: raw.split(/[\/-]/).filter(Boolean).slice(-2, -1)[0]?.trim() || raw.slice(0, 36), description: raw, amount: Math.abs(amount >= 0 ? number(row[amount]) : creditAmount || debitAmount), type: isCredit ? "credit" : "debit", category: categoryFor(raw, isCredit), confidence: .72, source, explanation: "Classified locally from statement narration." };
  }).filter((transaction) => transaction.amount > 0);
}

function summary(ledger) {
  const income = ledger.transactions.filter((t) => t.type === "credit").reduce((a, t) => a + t.amount, 0);
  const spend = ledger.transactions.filter((t) => t.type === "debit").reduce((a, t) => a + t.amount, 0);
  const byCategory = ledger.transactions.filter((t) => t.type === "debit").reduce((a, t) => ({ ...a, [t.category]: (a[t.category] || 0) + t.amount }), {});
  return { currency: ledger.currency || "INR", income, spend, saved: income - spend, savingsRate: income ? (income - spend) / income : 0, transactionCount: ledger.transactions.length, byCategory };
}

async function loadLedger() { try { return JSON.parse(await fs.readFile(LEDGER_PATH, "utf8")); } catch { return { currency: "INR", transactions: [], updatedAt: null }; } }
async function saveLedger(ledger) { await fs.mkdir(DATA_DIR, { recursive: true }); ledger.updatedAt = new Date().toISOString(); await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2)); }

async function gptParse(filePath) {
  if (!process.env.OPENAI_API_KEY) throw new Error("PDF and image statements require OPENAI_API_KEY. CSV imports work offline.");
  const buffer = await fs.readFile(filePath); const mime = filePath.endsWith(".pdf") ? "application/pdf" : filePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const inputItem = mime.startsWith("image/") ? { type: "input_image", image_url: `data:${mime};base64,${buffer.toString("base64")}` } : { type: "input_file", filename: path.basename(filePath), file_data: `data:${mime};base64,${buffer.toString("base64")}` };
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5.6", input: [{ role: "system", content: "Extract every bank-statement transaction. Return JSON with a transactions array. Each item needs date, merchant, description, positive amount, type (debit or credit), category, confidence, and explanation." }, { role: "user", content: [inputItem, { type: "input_text", text: "Normalize this complete statement. Categories: " + categories.join(", ") }] }], text: { format: { type: "json_object" } } }) });
  const json = await response.json(); if (!response.ok) throw new Error(json?.error?.message || "OpenAI request failed");
  const output = json.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  const parsed = JSON.parse(output || "{}");
  return (parsed.transactions || []).map((transaction, index) => ({ ...transaction, id: transaction.id || `txn-${Date.now()}-${index + 1}`, source: path.basename(filePath) }));
}

const server = new McpServer({ name: "finora", version: "1.0.0" });

server.registerTool("import_statement", { title: "Import bank or UPI statement", description: "Import a CSV, TSV, TXT, PDF, PNG, or JPEG statement into Finora's local normalized ledger. PDF and image inputs use GPT-5.6 when OPENAI_API_KEY is set.", inputSchema: { filePath: z.string().describe("Absolute or workspace-relative statement path"), replace: z.boolean().optional().default(false) } }, async ({ filePath, replace }) => {
  const resolved = path.resolve(filePath); const extension = path.extname(resolved).toLowerCase();
  const transactions = [".csv", ".tsv", ".txt"].includes(extension) ? parseCsv(await fs.readFile(resolved, "utf8"), path.basename(resolved)) : await gptParse(resolved);
  const ledger = replace ? { currency: "INR", transactions: [] } : await loadLedger(); ledger.transactions.push(...transactions); await saveLedger(ledger);
  const result = { imported: transactions.length, source: path.basename(resolved), ledgerPath: LEDGER_PATH, summary: summary(ledger) };
  return { content: [{ type: "text", text: `Imported ${transactions.length} transactions from ${path.basename(resolved)}.` }], structuredContent: result };
});

server.registerTool("get_spending_summary", { title: "Get spending summary", description: "Summarize the current Finora ledger by income, spend, savings, and category.", inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
  const ledger = await loadLedger(); const result = summary(ledger);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
});

server.registerTool("list_transactions", { title: "List ledger transactions", description: "Search and filter normalized Finora transactions with their evidence and confidence.", inputSchema: { query: z.string().optional(), category: z.enum(categories).optional(), limit: z.number().int().min(1).max(200).optional().default(50) }, annotations: { readOnlyHint: true } }, async ({ query, category, limit }) => {
  const ledger = await loadLedger(); const needle = query?.toLowerCase();
  const transactions = ledger.transactions.filter((t) => (!category || t.category === category) && (!needle || `${t.merchant} ${t.description}`.toLowerCase().includes(needle))).slice(0, limit);
  return { content: [{ type: "text", text: JSON.stringify(transactions, null, 2) }], structuredContent: { transactions, count: transactions.length } };
});

server.registerTool("correct_category", { title: "Correct a transaction category", description: "Apply a user-confirmed category correction to one ledger transaction.", inputSchema: { transactionId: z.string(), category: z.enum(categories) } }, async ({ transactionId, category }) => {
  const ledger = await loadLedger(); const transaction = ledger.transactions.find((t) => t.id === transactionId); if (!transaction) throw new Error("Transaction not found.");
  transaction.category = category; transaction.confidence = 1; transaction.explanation = "Category confirmed by the user."; await saveLedger(ledger);
  return { content: [{ type: "text", text: `Updated ${transaction.merchant} to ${category}.` }], structuredContent: { transaction } };
});

server.registerTool("sync_to_google_sheets", { title: "Sync ledger to Google Sheets", description: "Send the current Finora ledger to the provided Google Apps Script web app, which creates summary tabs and charts.", inputSchema: { webhookUrl: z.string().url(), secret: z.string().optional() } }, async ({ webhookUrl, secret }) => {
  const ledger = await loadLedger(); const response = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ secret, statement: { ...ledger, insights: [] } }), redirect: "follow" });
  const result = JSON.parse(await response.text()); if (!response.ok || result.ok === false) throw new Error(result.error || "Sheets sync failed.");
  return { content: [{ type: "text", text: `Synced ${ledger.transactions.length} transactions to Google Sheets.` }], structuredContent: result };
});

await server.connect(new StdioServerTransport());

