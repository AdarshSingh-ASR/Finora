import assert from "node:assert/strict";
import test from "node:test";
import { generateWithFallback } from "../lib/ai-providers.mjs";

test("uses Groq GPT-OSS as the text fallback with strict JSON schema", async () => {
  const originalFetch = globalThis.fetch;
  const originalVertex = process.env.GOOGLE_VERTEX_CREDENTIALS;
  const originalGroq = process.env.GROQ_API_KEY;
  delete process.env.GOOGLE_VERTEX_CREDENTIALS;
  process.env.GROQ_API_KEY = "test-key";
  let requestBody;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    requestBody = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  };
  try {
    const schema = { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const result = await generateWithFallback({ system: "Return JSON.", prompt: "Test", schema });
    assert.equal(result.provider, "groq");
    assert.equal(result.model, "openai/gpt-oss-20b");
    assert.equal(requestBody.response_format.json_schema.strict, true);
    assert.deepEqual(JSON.parse(result.text), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalVertex == null) delete process.env.GOOGLE_VERTEX_CREDENTIALS; else process.env.GOOGLE_VERTEX_CREDENTIALS = originalVertex;
    if (originalGroq == null) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalGroq;
  }
});

test("rejects malformed structured fallback responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalVertex = process.env.GOOGLE_VERTEX_CREDENTIALS;
  const originalGroq = process.env.GROQ_API_KEY;
  delete process.env.GOOGLE_VERTEX_CREDENTIALS;
  process.env.GROQ_API_KEY = "test-key";
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"transactions":[{"merchant":"unfinished' } }] });
  try {
    const schema = { type: "object", properties: { transactions: { type: "array" } } };
    await assert.rejects(
      generateWithFallback({ system: "Return JSON.", prompt: "Test", schema }),
      /incomplete structured data/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalVertex == null) delete process.env.GOOGLE_VERTEX_CREDENTIALS; else process.env.GOOGLE_VERTEX_CREDENTIALS = originalVertex;
    if (originalGroq == null) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalGroq;
  }
});
