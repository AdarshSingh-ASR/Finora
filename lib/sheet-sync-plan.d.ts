import type { Transaction } from "./types";

export const TRANSACTION_HEADER: string[];
export function transactionSheetRow(transaction: Transaction): Array<string | number>;
export type TransactionSheetSyncPlan = {
  updates: Array<{ rowNumber: number; values: Array<string | number> }>;
  appends: Array<Array<string | number>>;
  deleteRowNumbers: number[];
};
export function planTransactionSheetSync(existingRows: unknown[][], transactions: Transaction[]): TransactionSheetSyncPlan;
