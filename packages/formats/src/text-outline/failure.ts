import type { SketchTextOutlineResult } from "./contracts"

type Diagnostic = Extract<SketchTextOutlineResult, { ok: false }>["diagnostics"][number]

export class OutlineFailure extends Error {
  readonly diagnostic: Diagnostic

  constructor(
    code: Diagnostic["code"],
    message: string,
    details: Pick<Diagnostic, "glyphOrdinal" | "codePoint"> = {},
  ) {
    super(message)
    this.diagnostic = { code, message, ...details }
  }
}
