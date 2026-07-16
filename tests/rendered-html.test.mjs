import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

test("build contains the Finora product experience", async () => {
  const landing = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  const page = `${landing}\n${dashboard}`;
  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const assets = await readdir(assetsDirectory);
  assert.ok(assets.some((asset) => asset.startsWith("page-") && asset.endsWith(".js")), "missing compiled page asset");
  assert.match(page, /Finora|finora/); assert.match(page, /Your money/); assert.match(page, /Transactions/); assert.match(page, /FINANCIAL HEALTH/); assert.match(page, /SUBSCRIPTIONS/); assert.match(page, /Google Sheets|Sync Sheets/);
  assert.match(page, /Sign in/); assert.match(page, /AI Reports/); assert.match(page, /Every Sunday/); assert.match(page, /First of every month/);
  assert.match(dashboard, /Create Finora Financial Dashboard/); assert.match(dashboard, /Open Sheet/); assert.match(dashboard, /Disconnect from Finora/);
  assert.doesNotMatch(dashboard, /Apps Script web app URL|Matches FINORA_SECRET/);
  assert.match(landing, /Every statement/); assert.match(landing, /The MCP is/); assert.match(landing, /Raw files are never kept/);
  assert.match(dashboard, /No sample transactions\. Your dashboard starts empty\./);
  assert.doesNotMatch(page, /sampleStatement|defaultBudgets|codex-preview|Your site is taking shape|react-loading-skeleton/);
});
