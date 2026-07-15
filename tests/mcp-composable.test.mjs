import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP exposes composable finance tools and parses bank variants", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "finora-test-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value != null)); delete env.GOOGLE_VERTEX_CREDENTIALS; delete env.GROQ_API_KEY; env.FINORA_DATA_DIR = dataDir;
  const client = new Client({ name: "finora-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: "node", args: ["mcp/server.mjs"], cwd: process.cwd(), env });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of ["parse_statement", "categorize_transactions", "summarize_transactions", "detect_subscriptions", "find_duplicate_transactions", "detect_spending_anomalies", "budget_status", "financial_health_score", "sync_to_sheet"]) assert.ok(tools.includes(name), `missing ${name}`);
    for (const file of ["samples/fixtures/hdfc.csv", "samples/fixtures/sbi.csv", "samples/fixtures/icici.csv"]) {
      const parsed = await client.callTool({ name: "parse_statement", arguments: { filePath: file } });
      assert.ok(parsed.structuredContent.count >= 2, `${file} did not parse`);
      const categorized = await client.callTool({ name: "categorize_transactions", arguments: { transactions: parsed.structuredContent.transactions } });
      assert.equal(categorized.structuredContent.count, parsed.structuredContent.count);
      assert.ok(categorized.structuredContent.transactions.every((transaction) => transaction.category && transaction.confidence));
    }
  } finally { await client.close(); await rm(dataDir, { recursive: true, force: true }); }
});
