/// <reference lib="webworker" />

import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import { createDocumentWorkerRuntime } from "./runtime"

const workerScope = self as DedicatedWorkerGlobalScope
const runtime = createDocumentWorkerRuntime(new ReplicadGeometryEngine(), {
  postMessage(message, transfer = []) {
    workerScope.postMessage(message, { transfer })
  },
})

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  void runtime.handle(event.data)
})
