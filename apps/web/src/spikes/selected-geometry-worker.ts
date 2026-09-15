/// <reference lib="webworker" />

import { resolveSelectedEdgeCandidates } from "@vibeshape/application/selected-edge-resolution"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import { createGeometryWorkerRuntime } from "@vibeshape/geometry-worker/runtime"

const scope = self as DedicatedWorkerGlobalScope
const runtime = createGeometryWorkerRuntime(
  new ReplicadGeometryEngine(resolveSelectedEdgeCandidates),
  {
    postMessage(message, transfer = []) {
      scope.postMessage(message, { transfer })
    },
  },
)
scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  void runtime.handle(event.data)
})
