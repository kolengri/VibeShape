import DocumentWorkerConstructor from "./worker-entry?worker"

export * from "./client-core"

import { DocumentWorkerClient } from "./client-core"

export function createDocumentWorkerClient() {
  return new DocumentWorkerClient(new DocumentWorkerConstructor())
}
