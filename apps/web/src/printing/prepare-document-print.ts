import { createDocumentWorkerSession } from "@vibeshape/document-worker/session"
import type { DocumentSnapshot } from "@vibeshape/domain"
import type { PrintPreparationSettings } from "@vibeshape/protocol"
import type { ActiveDocumentExportResult } from "../document/document-controller"
import { PRODUCT_MESH_POLICY } from "../document/document-worker-settings"

function failed(message: string): ActiveDocumentExportResult {
  return {
    ok: false,
    diagnostic: { code: "export-failed", message, retryable: true, sourceCode: null },
  }
}

export async function prepareDocumentPrint(
  snapshot: DocumentSnapshot,
  settings: PrintPreparationSettings,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<ActiveDocumentExportResult> {
  if (signal.aborted || !isCurrent()) return failed("The print source is no longer current.")
  const worker = createDocumentWorkerSession(snapshot.id, { retryRecoverableFailure: false })
  const cancel = () => worker.terminate()
  signal.addEventListener("abort", cancel, { once: true })
  try {
    await worker.rebuild({ document: snapshot, mesh: PRODUCT_MESH_POLICY })
    if (signal.aborted || !isCurrent())
      return failed("Print preparation was canceled or its source changed.")
    const response = await worker.exportDocument("3mf", { printPreparation: settings })
    if (signal.aborted || !isCurrent())
      return failed("Print preparation was canceled or its source changed.")
    return {
      ok: true,
      format: response.format,
      documentName: snapshot.name,
      file: response.file,
      bodyCount: response.bodyCount,
      ...(response.printPreparation ? { printPreparation: response.printPreparation } : {}),
    }
  } catch {
    return failed("The print copy could not be prepared.")
  } finally {
    signal.removeEventListener("abort", cancel)
    worker.terminate()
  }
}
