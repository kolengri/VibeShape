import type { SectionCapWorker } from "../src/section-cap-client"
import type { SectionCapRequest } from "../src/section-cap-protocol"
import { SectionCapRuntime } from "../src/section-cap-runtime"

/** Native clone/transfer ownership with manually scheduled worker completions. */
export class ManualSectionCapWorker extends EventTarget implements SectionCapWorker {
  readonly requests: SectionCapRequest[] = []
  readonly transfers: ArrayBuffer[][] = []
  readonly outputTransfers: ArrayBuffer[][] = []
  readonly #runtime = new SectionCapRuntime()
  #completed = 0
  terminated = false

  postMessage(request: SectionCapRequest, transfer: ArrayBuffer[]) {
    this.requests.push(structuredClone(request, { transfer }))
    this.transfers.push(transfer)
  }

  respond(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: value }))
  }

  complete(index = this.#completed) {
    const request = this.requests[index]
    if (!request) throw new Error("Expected a dispatched section cap request.")
    this.#completed = index + 1
    const response = this.#runtime.process(request)
    const transfer: ArrayBuffer[] = []
    if (response.type === "sectionCapsComputed")
      for (const cap of response.caps) if (cap) transfer.push(cap.buffer)
    const data = structuredClone(response, { transfer })
    this.outputTransfers.push(transfer)
    this.respond(data)
  }

  // fallow-ignore-next-line unused-class-member -- Drains active and queued requests through workers.at(-1) in section-view-decoration.test.ts.
  completeAll() {
    while (this.#completed < this.requests.length) this.complete()
  }

  terminate() {
    this.terminated = true
  }
}
