export * from "./client-core"

import { createBrowserDocumentWorker } from "./browser-worker-startup-factory"
import { DocumentWorkerClient } from "./client-core"

export function createDocumentWorkerClient() {
  return new DocumentWorkerClient(createBrowserDocumentWorker())
}
