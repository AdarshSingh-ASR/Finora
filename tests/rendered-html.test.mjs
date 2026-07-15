import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

test("build contains the Finora product experience", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const assets = await readdir(assetsDirectory);
  assert.ok(assets.some((asset) => asset.startsWith("page-") && asset.endsWith(".js")), "missing compiled page asset");
  assert.match(page, /Finora|finora/); assert.match(page, /Your money/); assert.match(page, /Transactions/); assert.match(page, /FINANCIAL HEALTH/); assert.match(page, /SUBSCRIPTIONS/); assert.match(page, /Google Sheets|Sync Sheets/);
  assert.match(page, /Sign in/); assert.match(page, /Gmail every Sunday/);
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
