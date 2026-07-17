import type { Category, Transaction } from "./types";

export const categoryValues: Category[];
export function normalizeMerchantName(raw?: string): string;
export function classifyNarration(input?: Partial<Transaction>): { category: Category; confidence: number; reason: string; merchant: string };
export function refineTransaction<T extends Partial<Transaction>>(transaction: T, options?: { catchAllOnly?: boolean }): T & Partial<Transaction>;
export function refineTransactionsForAnalysis<T extends Transaction>(transactions?: T[]): T[];
export function isCatchAllCategory(category?: string): boolean;
export function transactionDetail(transaction: Partial<Transaction>): string;
