import { processEdgePreparation } from "./edge-preparation-runtime"

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const response = processEdgePreparation(event.data)
  const transfer = response.type === "edgesPrepared" ? [response.positions.buffer] : []
  self.postMessage(response, { transfer })
})
