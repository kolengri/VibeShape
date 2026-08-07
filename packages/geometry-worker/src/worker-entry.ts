/// <reference lib="webworker" />

import { ReplicadGeometryEngine } from "./engine"
import { createGeometryWorkerRuntime } from "./runtime"

const workerScope = self as DedicatedWorkerGlobalScope
const runtime = createGeometryWorkerRuntime(new ReplicadGeometryEngine(), {
  postMessage(message, transfer = []) {
    workerScope.postMessage(message, { transfer })
  },
})

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  void runtime.handle(event.data)
})
