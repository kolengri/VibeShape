/// <reference lib="webworker" />

import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import { createBrowserSketchSolvePort } from "@vibeshape/sketch-solver/browser"
import { createDocumentWorkerRuntime } from "./runtime"

const workerScope = self as DedicatedWorkerGlobalScope
let sketchSolvePortPromise: ReturnType<typeof createBrowserSketchSolvePort> | null = null
const runtime = createDocumentWorkerRuntime(
  new ReplicadGeometryEngine(),
  {
    postMessage(message, transfer = []) {
      workerScope.postMessage(message, { transfer })
    },
  },
  {
    async solveSketch(input) {
      sketchSolvePortPromise ??= createBrowserSketchSolvePort()
      const solveSketch = await sketchSolvePortPromise
      return solveSketch(input)
    },
  },
)

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  void runtime.handle(event.data)
})
