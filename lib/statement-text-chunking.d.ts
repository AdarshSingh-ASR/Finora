import type { ExtractedPdfPage, StatementTextChunk } from "./statement-extraction";

export function createStatementTextChunks(pages: ExtractedPdfPage[], maxChars?: number): StatementTextChunk[];
export function mapWithConcurrency<T, R>(items: Iterable<T>, concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>;
export function configuredChunkConcurrency(value: unknown, fallback?: number): number;
