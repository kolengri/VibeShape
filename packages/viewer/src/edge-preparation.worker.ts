import { processEdgePreparation } from "./edge-preparation-runtime"

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const response = processEdgePreparation(event.data)
  const transfer: ArrayBuffer[] =
    response.type === "edgesPrepared"
      ? [
          response.positions.buffer,
          ...(response.picking?.roots ?? []),
          ...(response.picking ? [response.picking.indirectBuffer.buffer] : []),
        ]
      : []
  self.postMessage(response, { transfer })
})
