import assert from "node:assert/strict";
import test from "node:test";
import { generateAdaptiveStatementRange } from "../lib/statement-chunking.mjs";
import { configuredChunkConcurrency, createStatementTextChunks, mapWithConcurrency } from "../lib/statement-text-chunking.mjs";

test("large failed statement ranges are recursively split without gaps", async () => {
  const calls = [];
  const results = await generateAdaptiveStatementRange({
    start: 1,
    end: 60,
    minimumRangeSize: 8,
    generate: async (start, end) => {
      calls.push([start, end]);
      if (end - start + 1 > 15) throw new Error("Vertex AI returned incomplete structured data.");
      return { start, end };
    },
  });

  assert.deepEqual(results, [
    { start: 1, end: 15 },
    { start: 16, end: 30 },
    { start: 31, end: 45 },
    { start: 46, end: 60 },
  ]);
  assert.deepEqual(calls[0], [1, 60]);
  assert.equal(results[0].start, 1);
  assert.equal(results.at(-1).end, 60);
  for (let index = 1; index < results.length; index += 1) assert.equal(results[index - 1].end + 1, results[index].start);
});

test("small failed ranges get one final retry and unrelated errors are not hidden", async () => {
  let attempts = 0;
  const retried = await generateAdaptiveStatementRange({
    start: 1,
    end: 8,
    minimumRangeSize: 8,
    generate: async (start, end, retry) => {
      attempts += 1;
      if (!retry) throw new Error("Unterminated string in JSON");
      return { start, end, retry };
    },
  });
  assert.equal(attempts, 2);
  assert.deepEqual(retried, [{ start: 1, end: 8, retry: true }]);

  await assert.rejects(
    generateAdaptiveStatementRange({ start: 1, end: 60, generate: async () => { throw new Error("Vertex AI request failed (403)."); } }),
    /403/,
  );
});

test("layout-preserving pages become ordered chunks without splitting ordinary pages", () => {
  const pages = [
    { pageNumber: 1, lines: ["01/01/2026 Coffee 120 Dr"], text: "01/01/2026 Coffee 120 Dr" },
    { pageNumber: 2, lines: ["02/01/2026 Metro 80 Dr"], text: "02/01/2026 Metro 80 Dr" },
    { pageNumber: 3, lines: ["03/01/2026 Salary 50000 Cr"], text: "03/01/2026 Salary 50000 Cr" },
  ];
  const chunks = createStatementTextChunks(pages, 2000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startPage, 1);
  assert.equal(chunks[0].endPage, 3);
  assert.match(chunks[0].text, /Page 1/);
  assert.match(chunks[0].text, /Page 3/);
});

test("chunk workers preserve source order and obey configured bounded concurrency", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], configuredChunkConcurrency("3"), async (value) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 8 : 2));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 3);
  assert.equal(configuredChunkConcurrency("0"), 3);
  assert.equal(configuredChunkConcurrency("99"), 8);
});
