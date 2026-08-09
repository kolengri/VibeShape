import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerRequest,
  type DocumentWorkerResponse,
  documentRebuildSnapshotSchema,
} from "@vibeshape/protocol"
import { describe, expect, it, vi } from "vitest"
import { DocumentWorkerClient, DocumentWorkerRequestError } from "./client-core"

const documentId = "0195b5ac-b213-7f2c-9c33-67a36a7f21ac"
const featureId = "0195b5ac-b220-7a2c-8c33-67a36a7f3101"

class FakeWorker {
  readonly posted: DocumentWorkerRequest[] = []
  terminated = false
  #errorListener: ((event: ErrorEvent) => void) | null = null
  #messageErrorListener: ((event: MessageEvent<unknown>) => void) | null = null
  #messageListener: ((event: MessageEvent<unknown>) => void) | null = null

  postMessage(message: DocumentWorkerRequest) {
    this.posted.push(message)
  }

  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
  ) {
    if (type === "error") {
      this.#errorListener = listener as (event: ErrorEvent) => void
      return
    }
    if (type === "messageerror") {
      this.#messageErrorListener = listener as (event: MessageEvent<unknown>) => void
      return
    }
    this.#messageListener = listener as (event: MessageEvent<unknown>) => void
  }

  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
  ) {
    if (type === "error") {
      if (this.#errorListener === listener) this.#errorListener = null
      return
    }
    if (type === "messageerror") {
      if (this.#messageErrorListener === listener) this.#messageErrorListener = null
      return
    }
    if (this.#messageListener === listener) this.#messageListener = null
  }

  terminate() {
    this.terminated = true
  }

  emit(message: DocumentWorkerResponse | unknown) {
    this.#messageListener?.({ data: message } as MessageEvent<unknown>)
  }

  emitError(message: string) {
    this.#errorListener?.({ message } as ErrorEvent)
  }

  emitMessageError() {
    this.#messageErrorListener?.({ data: null } as MessageEvent<unknown>)
  }
}

function healthRequest(requestId = "health-request"): DocumentWorkerRequest {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId,
    documentId,
    revision: 3,
    generation: 2,
    type: "healthCheck",
  }
}

function healthResponse(requestId = "health-request"): DocumentWorkerResponse {
  return {
    ...healthRequest(requestId),
    type: "health",
    initialized: true,
    activeDocuments: 1,
    ownedShapeCount: 3,
    wasmHeapBytes: 1024,
  }
}

function rebuildRequest(requestId = "rebuild-request"): DocumentWorkerRequest {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId,
    documentId,
    revision: 3,
    generation: 2,
    type: "rebuildDocument",
    document: documentRebuildSnapshotSchema.parse({
      schemaVersion: 0,
      id: documentId,
      revision: 3,
      name: "Client test",
      features: [
        {
          schemaVersion: 0,
          id: featureId,
          type: {
            moduleId: "org.vibeshape.core.part-design",
            moduleVersion: "0.1.0",
            typeId: "org.vibeshape.feature.part-design.box",
            schemaVersion: 1,
          },
          parameters: {
            width: { value: 20, unit: "mm" },
            depth: { value: 30, unit: "mm" },
            height: { value: 40, unit: "mm" },
            centered: false,
          },
          dependencies: [],
          references: [],
          suppressed: false,
        },
      ],
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    }),
    mesh: { chordTolerance: 0.05, angularTolerance: 0.1 },
  }
}

function responseEnvelope(request: DocumentWorkerRequest) {
  return {
    protocolVersion: request.protocolVersion,
    requestId: request.requestId,
    documentId: request.documentId,
    revision: request.revision,
    generation: request.generation,
  }
}

function exportRequest(requestId = "export-request"): DocumentWorkerRequest {
  return {
    ...healthRequest(requestId),
    type: "exportDocument",
    format: "step",
  }
}

describe("DocumentWorkerClient", () => {
  it("resolves a matching terminal response", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const pending = client.request(healthRequest())
    worker.emit(healthResponse())

    await expect(pending).resolves.toMatchObject({ type: "health", activeDocuments: 1 })
  })

  it("resolves an exact exported file response", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const request = exportRequest()
    const pending = client.request(request)
    worker.emit({
      ...responseEnvelope(request),
      type: "documentExported",
      format: "step",
      file: new Uint8Array([1, 2, 3]),
      bodyCount: 1,
    })

    await expect(pending).resolves.toMatchObject({
      type: "documentExported",
      file: new Uint8Array([1, 2, 3]),
    })
  })

  it("routes progress only for rebuild requests", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const onProgress = vi.fn()
    const pending = client.request(rebuildRequest(), { onProgress })

    worker.emit({
      ...responseEnvelope(rebuildRequest()),
      type: "progress",
      featureId,
      stage: "feature-evaluation",
      fraction: 0.5,
    })
    worker.emit({
      ...responseEnvelope(rebuildRequest()),
      type: "failure",
      diagnostic: { code: "internal-error", message: "Stop test rebuild.", retryable: false },
    })

    await expect(pending).rejects.toThrow("Stop test rebuild")
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: "progress", featureId, fraction: 0.5 }),
    )
  })

  it("rejects response types that do not match the request", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const pending = client.request(healthRequest())

    worker.emit({ ...healthRequest(), type: "documentDisposed", ownedShapeCount: 0 })

    await expect(pending).rejects.toThrow("mismatched response type")
  })

  it("rejects response envelope drift", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const pending = client.request(healthRequest())

    worker.emit({ ...healthResponse(), revision: 4 })

    await expect(pending).rejects.toThrow("mismatched response envelope")
  })

  it("surfaces structured worker failures", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const pending = client.request(healthRequest())

    worker.emit({
      ...healthRequest(),
      type: "failure",
      diagnostic: {
        code: "engine-initialization-failed",
        message: "Kernel initialization failed.",
        retryable: true,
      },
    })

    await expect(pending).rejects.toMatchObject({
      name: "DocumentWorkerRequestError",
      message: "Kernel initialization failed.",
      response: { type: "failure", diagnostic: { retryable: true } },
    })
  })

  it("rejects duplicate pending IDs and all requests on termination", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const first = client.request(healthRequest())

    await expect(client.request(healthRequest())).rejects.toThrow("already pending")
    client.terminate()

    await expect(first).rejects.toBeInstanceOf(DocumentWorkerRequestError)
    expect(worker.terminated).toBe(true)
  })

  it("rejects every pending request after an invalid worker response", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const first = client.request(healthRequest("first"))
    const second = client.request(healthRequest("second"))

    worker.emit({ type: "not-a-document-response" })

    await expect(first).rejects.toThrow("invalid response")
    await expect(second).rejects.toThrow("invalid response")
  })

  it("rejects pending work immediately when the worker crashes", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const pending = client.request(healthRequest())

    worker.emitError("OCCT worker crashed.")

    await expect(pending).rejects.toMatchObject({
      code: "worker-error",
      message: "OCCT worker crashed.",
    })
    await expect(client.request(healthRequest("after-crash"))).rejects.toMatchObject({
      code: "worker-terminated",
    })
    client.terminate()
    expect(worker.terminated).toBe(true)
  })

  it("rejects pending work after a structured-clone message failure", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    const pending = client.request(healthRequest())

    worker.emitMessageError()

    await expect(pending).rejects.toMatchObject({ code: "message-error" })
  })

  it("classifies request timeouts for session recovery", async () => {
    const worker = new FakeWorker()
    const client = new DocumentWorkerClient(worker)
    try {
      await expect(client.request(healthRequest(), { timeoutMs: 5 })).rejects.toMatchObject({
        code: "request-timeout",
      })
    } finally {
      client.terminate()
    }
  })
})
