const DEFAULT_MAX_CHARS = 14_000;

function pageText(page) {
  const text = String(page?.text || (Array.isArray(page?.lines) ? page.lines.join("\n") : "")).trim();
  return text ? `--- Page ${Number(page?.pageNumber) || 1} ---\n${text}` : "";
}

function splitOversizedPage(page, maxChars) {
  const lines = Array.isArray(page?.lines) && page.lines.length ? page.lines.map(String) : String(page?.text || "").split(/\r?\n/);
  const parts = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    const next = String(line).trim();
    if (!next) continue;
    if (current.length && size + next.length + 1 > maxChars) {
      parts.push(current.join("\n")); current = []; size = 0;
    }
    current.push(next); size += next.length + 1;
  }
  if (current.length) parts.push(current.join("\n"));
  return parts.length ? parts : [String(page?.text || "")];
}

export function createStatementTextChunks(pages, maxChars = DEFAULT_MAX_CHARS) {
  const safeMax = Math.max(2_000, Number(maxChars) || DEFAULT_MAX_CHARS);
  const chunks = [];
  let current = [];
  let currentSize = 0;
  let startPage = 0;
  let endPage = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push({ id: `pages-${startPage}-${endPage}-${chunks.length + 1}`, startPage, endPage, text: current.join("\n\n") });
    current = []; currentSize = 0; startPage = 0; endPage = 0;
  };

  for (const page of Array.isArray(pages) ? pages : []) {
    const number = Math.max(1, Number(page?.pageNumber) || 1);
    const formatted = pageText(page);
    if (!formatted) continue;
    if (formatted.length > safeMax) {
      flush();
      for (const part of splitOversizedPage(page, safeMax - 80)) {
        chunks.push({ id: `page-${number}-part-${chunks.length + 1}`, startPage: number, endPage: number, text: `--- Page ${number} ---\n${part}` });
      }
      continue;
    }
    if (current.length && currentSize + formatted.length + 2 > safeMax) flush();
    if (!current.length) startPage = number;
    current.push(formatted); currentSize += formatted.length + 2; endPage = number;
  }
  flush();
  return chunks;
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const input = Array.from(items || []);
  if (!input.length) return [];
  const limit = Math.max(1, Math.min(input.length, Math.floor(Number(concurrency) || 1)));
  const results = new Array(input.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < input.length) {
      const index = nextIndex++;
      results[index] = await worker(input[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return results;
}

export function configuredChunkConcurrency(value, fallback = 3) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(8, Math.floor(parsed)) : fallback;
}
