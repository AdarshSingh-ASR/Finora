const recoverablePattern = /incomplete|structured|output limit|maximum token|token|json|unterminated|batch/i;

export function isRecoverableStatementError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return recoverablePattern.test(message);
}

/**
 * Generate one requested statement range. If a model cannot close the JSON for a
 * large range, recursively divide that exact range so no transaction indexes are
 * skipped. Only the smallest ranges are retried unchanged for transient failures.
 */
export async function generateAdaptiveStatementRange({ start, end, minimumRangeSize = 8, generate }) {
  async function visit(rangeStart, rangeEnd) {
    try {
      return [await generate(rangeStart, rangeEnd, false)];
    } catch (error) {
      if (!isRecoverableStatementError(error)) throw error;
      const size = rangeEnd - rangeStart + 1;
      if (size > minimumRangeSize) {
        const midpoint = rangeStart + Math.floor(size / 2) - 1;
        const left = await visit(rangeStart, midpoint);
        const right = await visit(midpoint + 1, rangeEnd);
        return [...left, ...right];
      }
      return [await generate(rangeStart, rangeEnd, true)];
    }
  }

  return visit(start, end);
}
