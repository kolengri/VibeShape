/**
 * A drawing exceeded a fixed projection budget. The input is deterministic, so retrying the same
 * model and views cannot succeed; callers report it as non-retryable.
 */
export class DrawingBudgetError extends Error {
  override readonly name = "DrawingBudgetError"
}
