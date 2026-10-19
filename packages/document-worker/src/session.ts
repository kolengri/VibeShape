export * from "./session-core"

import { createBrowserDocumentWorker } from "./browser-worker-startup-factory"
import { DocumentWorkerClient } from "./client-core"
import { DocumentWorkerSession, type DocumentWorkerSessionOptions } from "./session-core"

export function createDocumentWorkerSession(
  documentId: string,
  options: DocumentWorkerSessionOptions = {},
) {
  return new DocumentWorkerSession(
    documentId,
    () => new DocumentWorkerClient(createBrowserDocumentWorker()),
    options,
  )
}
