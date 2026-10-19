import { createBrowserWorkerStartupFactory } from "./browser-worker-startup"
import DocumentWorkerConstructor from "./worker-entry?worker"

export const createBrowserDocumentWorker = createBrowserWorkerStartupFactory(
  () => new DocumentWorkerConstructor(),
)
