export type StatementExtractionMode = "deterministic" | "text-layer" | "multimodal";

export type ExtractedPdfTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ExtractedPdfPage = {
  pageNumber: number;
  width: number;
  height: number;
  lines: string[];
  text: string;
};

export type StatementTextChunk = {
  id: string;
  startPage: number;
  endPage: number;
  text: string;
};

export type StatementChunkResult<T> = {
  chunk: StatementTextChunk;
  value: T;
  warnings: string[];
};

export type PdfTextExtraction = {
  mode: "text-layer" | "multimodal";
  pages: ExtractedPdfPage[];
  textCharacters: number;
  dateSignals: number;
  amountSignals: number;
};
