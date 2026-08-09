import DocumentWorkerConstructor from "./worker-entry?worker"

export * from "./session-core"

import { DocumentWorkerClient } from "./client-core"
import { DocumentWorkerSession, type DocumentWorkerSessionOptions } from "./session-core"

export function createDocumentWorkerSession(
  documentId: string,
  options: DocumentWorkerSessionOptions = {},
) {
  return new DocumentWorkerSession(
    documentId,
    () => new DocumentWorkerClient(new DocumentWorkerConstructor()),
    options,
  )
}
