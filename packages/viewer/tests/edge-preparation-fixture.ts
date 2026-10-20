import { EdgePreparationClient, type EdgePreparationWorker } from "../src/edge-preparation"
import { processEdgePreparation } from "../src/edge-preparation-runtime"
import type { EdgePreparationRequest } from "../src/edge-preparation-schema"

/** Emulates native transfer semantics, while letting tests control completion and failures. */
export class ManualEdgeWorker extends EventTarget implements EdgePreparationWorker {
  readonly requests: EdgePreparationRequest[] = []
  readonly transfers: ArrayBuffer[][] = []
  terminated = false

  postMessage(request: EdgePreparationRequest, transfer: ArrayBuffer[]) {
    this.requests.push(structuredClone(request, { transfer }))
    this.transfers.push(transfer)
  }

  respond(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: value }))
  }

  complete(index = 0) {
    const request = this.requests[index]
    if (!request) throw new Error("Expected a dispatched edge request.")
    this.respond(processEdgePreparation(request))
  }

  terminate() {
    this.terminated = true
  }
}

export function edgePreparationFixture() {
  const worker = new ManualEdgeWorker()
  const errors: Error[] = []
  let creations = 0
  const client = new EdgePreparationClient(
    () => {
      creations += 1
      return worker
    },
    (error) => errors.push(error),
  )
  return {
    worker,
    client,
    errors,
    get creations() {
      return creations
    },
  }
}
