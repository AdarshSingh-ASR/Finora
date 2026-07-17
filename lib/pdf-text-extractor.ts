import type { ExtractedPdfPage, ExtractedPdfTextItem, PdfTextExtraction } from "./statement-extraction";

type PdfJsTextItem = { str: string; width: number; height: number; transform: number[] };

function reconstructLines(items: ExtractedPdfTextItem[]) {
  const sorted = [...items].filter((item) => item.text.trim()).sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
  const groups: Array<{ y: number; items: ExtractedPdfTextItem[] }> = [];
  for (const item of sorted) {
    const tolerance = Math.max(2, item.height * 0.45);
    const line = groups.find((group) => Math.abs(group.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else groups.push({ y: item.y, items: [item] });
  }
  return groups.sort((a, b) => b.y - a.y).map((group) => {
    const line = group.items.sort((a, b) => a.x - b.x);
    let output = "";
    let previousEnd = 0;
    for (const item of line) {
      const gap = item.x - previousEnd;
      if (output && gap > Math.max(2, item.height * 0.18)) output += gap > item.height * 1.8 ? "   " : " ";
      output += item.text.trim();
      previousEnd = Math.max(previousEnd, item.x + item.width);
    }
    return output.replace(/\s{4,}/g, "   ").trim();
  }).filter(Boolean);
}

function signalCount(text: string, pattern: RegExp) {
  return text.match(pattern)?.length || 0;
}

export async function extractPdfText(file: File, onProgress?: (label: string) => void): Promise<PdfTextExtraction> {
  onProgress?.("Extracting statement text…");
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true }).promise;
  const pageCount = document.numPages;
  const pages: ExtractedPdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    onProgress?.(`Extracting page ${pageNumber} of ${pageCount}…`);
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.flatMap((raw): ExtractedPdfTextItem[] => {
      if (!("str" in raw)) return [];
      const item = raw as PdfJsTextItem;
      return [{ text: item.str, x: Number(item.transform?.[4]) || 0, y: Number(item.transform?.[5]) || 0, width: Number(item.width) || 0, height: Number(item.height) || 0 }];
    });
    const lines = reconstructLines(items);
    pages.push({ pageNumber, width: viewport.width, height: viewport.height, lines, text: lines.join("\n") });
    page.cleanup();
  }
  await document.destroy();
  const text = pages.map((page) => page.text).join("\n");
  const textCharacters = text.replace(/\s/g, "").length;
  const dateSignals = signalCount(text, /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{2}|\d{4})|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/gi);
  const amountSignals = signalCount(text, /(?:₹|INR|Rs\.?|USD|EUR|GBP)?\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:Cr|Dr))?/gi);
  const usable = textCharacters >= Math.max(200, pageCount * 70) && dateSignals >= 2 && amountSignals >= 3;
  return { mode: usable ? "text-layer" : "multimodal", pages: usable ? pages : [], textCharacters, dateSignals, amountSignals };
}
