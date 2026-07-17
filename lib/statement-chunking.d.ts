export function isRecoverableStatementError(error: unknown): boolean;

export function generateAdaptiveStatementRange<T>(options: {
  start: number;
  end: number;
  minimumRangeSize?: number;
  generate: (start: number, end: number, retry: boolean) => Promise<T>;
}): Promise<T[]>;
