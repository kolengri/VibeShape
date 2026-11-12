import {
  BinaryExportPreparationError,
  type ModelFormat,
  type PreparedModelFile,
} from "./binary-export-session"

type ExportDiagnostic = Readonly<{
  code: string
  message: string
  retryable: boolean
  sourceCode?: string | null | undefined
}>
type ModelExportResult =
  | Readonly<{ ok: true; format: ModelFormat; file: Uint8Array }>
  | Readonly<{ ok: false; diagnostic: ExportDiagnostic }>

/**
 * MCP failure for a model export. A failed rebuild is final and names itself, a revision race is a
 * retryable stale revision, and anything else stays export-failed with the source's retry flag.
 */
export function modelExportFailure(diagnostic: ExportDiagnostic) {
  const { message } = diagnostic
  if (diagnostic.code === "rebuild-failed" || diagnostic.sourceCode === "rebuild-failed")
    return { code: "rebuild-failed", message, retryable: false }
  if (diagnostic.code === "stale-revision" || diagnostic.sourceCode === "stale-revision")
    return { code: "stale-revision", message, retryable: true }
  return { code: "export-failed", message, retryable: diagnostic.retryable }
}

/** The prepared file for `prepare_model_export`, or the mapped failure thrown to the session. */
export function preparedModelExport(
  result: ModelExportResult,
  documentId: string,
  revision: number,
  format: ModelFormat,
): PreparedModelFile {
  if (!result.ok) {
    const failure = modelExportFailure(result.diagnostic)
    throw new BinaryExportPreparationError(failure.code, failure.message, failure.retryable)
  }
  return { ok: true, documentId, revision, format, file: result.file }
}
