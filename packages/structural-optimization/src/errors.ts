export class StructuralOptimizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "StructuralOptimizationError"
  }
}
