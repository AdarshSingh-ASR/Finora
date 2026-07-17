import assert from "node:assert/strict";
import test from "node:test";
import { generateAdaptiveStatementRange } from "../lib/statement-chunking.mjs";

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
