import { afterEach, describe, expect, it } from "bun:test"
import {
  DOCUMENT_PROTOCOL_VERSION,
  type DocumentWorkerRequest,
  documentWorkerRequestSchema,
} from "@vibeshape/protocol"
import { vi } from "../../../tests/unit/support/bun-test"
import { createBrowserWorkerStartupFactory } from "./browser-worker-startup"
import { DocumentWorkerClient, type DocumentWorkerLike } from "./client-core"

type Events = {
  message: MessageEvent<unknown>
  error: ErrorEvent
  messageerror: MessageEvent<unknown>
}
type Listeners = { [Kind in keyof Events]: Set<(event: Events[Kind]) => void> }

class FakeWorker implements DocumentWorkerLike {
  readonly posted: DocumentWorkerRequest[] = []
  readonly listeners: Listeners = { message: new Set(), error: new Set(), messageerror: new Set() }
  terminations = 0
  rejectPosts = false

  postMessage(message: DocumentWorkerRequest) {
    if (this.rejectPosts) throw new Error("Injected native post failure")
    this.posted.push(message)
  }

  addEventListener<Kind extends keyof Events>(type: Kind, listener: (event: Events[Kind]) => void) {
    this.listeners[type].add(listener)
  }

  removeEventListener<Kind extends keyof Events>(
    type: Kind,
    listener: (event: Events[Kind]) => void,
  ) {
    this.listeners[type].delete(listener)
  }

  emit<Kind extends keyof Events>(type: Kind, event: Events[Kind]) {
    for (const listener of this.listeners[type]) listener(event)
  }

  reply(data: unknown) {
    this.emit("message", new MessageEvent("message", { data }))
  }

  terminate() {
    this.terminations += 1
  }

  get listenerCount() {
    return (
      this.listeners.message.size + this.listeners.error.size + this.listeners.messageerror.size
    )
  }
}

function setup() {
  vi.useFakeTimers()
  const natives: FakeWorker[] = []
  const create = createBrowserWorkerStartupFactory(() => {
    const native = new FakeWorker()
    natives.push(native)
    return native
  })
  return { natives, create }
}

function at(natives: FakeWorker[], index = 0) {
  const native = natives[index]
  if (!native) throw new Error(`Missing native worker ${index}`)
  return native
}

function health(native: FakeWorker) {
  const request = native.posted[0]
  if (request?.type !== "healthCheck") throw new Error("Missing bootstrap health check")
  return {
    ...request,
    type: "health" as const,
    initialized: false,
    activeDocuments: 0,
    ownedShapeCount: 0,
    wasmHeapBytes: 0,
  }
}

function request(requestId = "business-request"): DocumentWorkerRequest {
  return {
    protocolVersion: DOCUMENT_PROTOCOL_VERSION,
    requestId,
    documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
    generation: 2,
    revision: 3,
    type: "exportDocument",
    format: "step",
  }
}

async function drain() {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe("browser worker startup boundary", () => {
  it("sends only health before readiness, then preserves request identity, order, and event identity", async () => {
    const { create, natives } = setup()
    const port = create()
    const first = request("first")
    const second = request("second")
    const messages: MessageEvent<unknown>[] = []
    port.addEventListener("message", (event) => messages.push(event))
    port.postMessage(first)
    port.postMessage(second)
    await drain()
    const native = at(natives)
    expect(native.posted).toHaveLength(1)
    expect(documentWorkerRequestSchema.parse(native.posted[0]).type).toBe("healthCheck")
    native.reply(health(native))
    expect(messages).toHaveLength(0)
    expect(native.posted[1]).toBe(first)
    expect(native.posted[2]).toBe(second)
    const third = request("third")
    port.postMessage(third)
    expect(native.posted[3]).toBe(third)
    const response = new MessageEvent("message", { data: { unchanged: true } })
    native.emit("message", response)
    expect(messages).toEqual([response])
    expect(messages[0]).toBe(response)
    expect(vi.getTimerCount()).toBe(0)
    port.terminate()
    port.terminate()
    expect(native.terminations).toBe(1)
    expect(native.listenerCount).toBe(0)
  })

  it("rejects a real client immediately on cancellation without sending CAD or killing cold startup", async () => {
    const { create, natives } = setup()
    const client = new DocumentWorkerClient(create())
    const pending = client.request(request())
    const rejected = pending.catch((error: unknown) => error)
    await drain()
    const native = at(natives)
    client.terminate()
    expect(await rejected).toMatchObject({ code: "worker-terminated" })
    expect(native.terminations).toBe(0)
    expect(native.posted).toHaveLength(1)
    native.reply(health(native))
    expect(native.terminations).toBe(1)
    expect(native.posted).toHaveLength(1)
    expect(native.listenerCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("preserves typed-array references while business work waits for startup", async () => {
    const { create, natives } = setup()
    const port = create()
    const bytes = new Uint8Array([1, 2, 3])
    const message: DocumentWorkerRequest = {
      protocolVersion: DOCUMENT_PROTOCOL_VERSION,
      requestId: "mesh-request",
      documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ac",
      generation: 2,
      revision: 3,
      type: "inspectMeshImport",
      input: { format: "stl", units: "mm", bytes },
    }
    port.postMessage(message)
    await drain()
    const native = at(natives)
    native.reply(health(native))
    const posted = native.posted[1]
    expect(posted).toBe(message)
    if (posted?.type !== "inspectMeshImport") throw new Error("Missing queued mesh request")
    expect(posted.input.bytes).toBe(bytes)
    port.terminate()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps successful responses and request timeouts owned by the unchanged core client", async () => {
    const { create, natives } = setup()
    const client = new DocumentWorkerClient(create())
    const result = client.request(request())
    await drain()
    const native = at(natives)
    native.reply(health(native))
    const posted = native.posted[1]
    if (posted?.type !== "exportDocument") throw new Error("Missing queued export request")
    native.reply({ ...posted, type: "documentExported", file: new Uint8Array([1]), bodyCount: 1 })
    expect(await result).toMatchObject({ type: "documentExported", requestId: "business-request" })
    const expired = client
      .request(request("expires"), { timeoutMs: 10 })
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10)
    expect(await expired).toMatchObject({ code: "request-timeout" })
    expect(native.terminations).toBe(0)
    client.terminate()
    expect(native.terminations).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not construct cancelled leases before activation or while waiting behind two starts", async () => {
    const { create, natives } = setup()
    const neverStarted = create()
    neverStarted.terminate()
    await drain()
    expect(natives).toHaveLength(0)
    const first = create()
    const second = create()
    const waiting = create()
    waiting.postMessage(request())
    await drain()
    expect(natives).toHaveLength(2)
    waiting.terminate()
    first.terminate()
    second.terminate()
    for (const native of natives) native.reply(health(native))
    await drain()
    expect(natives).toHaveLength(2)
    expect(natives.map((native) => native.terminations)).toEqual([1, 1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("fails waiting and future clients closed after two retired starts, and recovers after late health", async () => {
    const { create, natives } = setup()
    const clients = Array.from({ length: 4 }, () => new DocumentWorkerClient(create()))
    const outcomes = clients.map((client, index) =>
      client.request(request(`request-${index}`)).catch((error: unknown) => error),
    )
    await drain()
    expect(natives).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(120_000)
    for (const outcome of await Promise.all(outcomes))
      expect(outcome).toMatchObject({ code: "worker-error" })
    expect(natives.map((native) => native.terminations)).toEqual([0, 0])
    expect(natives.map((native) => native.posted.length)).toEqual([1, 1])
    expect(vi.getTimerCount()).toBe(0)
    const refused = new DocumentWorkerClient(create())
    await expect(refused.request(request("refused"))).rejects.toMatchObject({
      code: "worker-error",
    })
    expect(natives).toHaveLength(2)
    at(natives).reply(health(at(natives)))
    const recovered = create()
    await drain()
    expect(natives).toHaveLength(3)
    expect(at(natives).terminations).toBe(1)
    expect(at(natives).listenerCount).toBe(0)
    recovered.terminate()
    at(natives, 1).reply(health(at(natives, 1)))
    at(natives, 2).reply(health(at(natives, 2)))
    expect(natives.map((native) => native.terminations)).toEqual([1, 1, 1])
    expect(vi.getTimerCount()).toBe(0)
    for (const client of clients) client.terminate()
    refused.terminate()
  })

  it("keeps cancelled unacknowledged starts inside the capacity budget until late acknowledgment", async () => {
    const { create, natives } = setup()
    const first = create()
    const second = create()
    await drain()
    first.terminate()
    second.terminate()
    await vi.advanceTimersByTimeAsync(120_000)
    const waiting = new DocumentWorkerClient(create())
    await expect(waiting.request(request())).rejects.toMatchObject({ code: "worker-error" })
    expect(natives).toHaveLength(2)
    expect(natives.map((native) => native.terminations)).toEqual([0, 0])
    for (const native of natives) native.reply(health(native))
    expect(natives.map((native) => native.terminations)).toEqual([1, 1])
    waiting.terminate()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { protocolVersion: 99 },
    { type: "not-health" },
    { requestId: "different-request" },
    { documentId: "0195b5ac-b213-7f2c-9c33-67a36a7f21ad" },
    { revision: 1 },
    { generation: 1 },
    { initialized: "false" },
  ])(
    "fails invalid or mismatched bootstrap replies without releasing the unsafe worker: %j",
    async (change) => {
      const { create, natives } = setup()
      const client = new DocumentWorkerClient(create())
      const rejected = client.request(request()).catch((error: unknown) => error)
      await drain()
      const native = at(natives)
      native.reply({ ...health(native), ...change })
      expect(await rejected).toMatchObject({ code: "worker-error" })
      expect(native.posted).toHaveLength(1)
      expect(native.terminations).toBe(0)
      native.reply({ malformed: true })
      expect(native.terminations).toBe(0)
      native.reply(health(native))
      expect(native.terminations).toBe(1)
      expect(native.listenerCount).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      client.terminate()
    },
  )

  it.each(["error", "messageerror"] as const)(
    "cleans up definitive native startup %s and frees queued capacity",
    async (type) => {
      const { create, natives } = setup()
      const client = new DocumentWorkerClient(create())
      const rejected = client.request(request()).catch((error: unknown) => error)
      const other = create()
      const waiting = create()
      await drain()
      const native = at(natives)
      if (type === "error")
        native.emit(type, new ErrorEvent(type, { message: "Injected startup failure" }))
      else native.emit(type, new MessageEvent(type))
      expect(await rejected).toMatchObject({
        code: type === "error" ? "worker-error" : "message-error",
      })
      await drain()
      expect(natives).toHaveLength(3)
      expect(native.terminations).toBe(1)
      expect(native.listenerCount).toBe(0)
      other.terminate()
      waiting.terminate()
      at(natives, 1).reply(health(at(natives, 1)))
      at(natives, 2).reply(health(at(natives, 2)))
      client.terminate()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it.each(["error", "messageerror"] as const)(
    "preserves the real core client's post-ready %s behavior",
    async (type) => {
      const { create, natives } = setup()
      const client = new DocumentWorkerClient(create())
      await drain()
      const native = at(natives)
      native.reply(health(native))
      const rejected = client.request(request()).catch((error: unknown) => error)
      if (type === "error")
        native.emit(type, new ErrorEvent(type, { message: "Injected ready failure" }))
      else native.emit(type, new MessageEvent(type))
      expect(await rejected).toMatchObject({
        code: type === "error" ? "worker-error" : "message-error",
      })
      client.terminate()
      expect(native.terminations).toBe(1)
      expect(native.listenerCount).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it("reports constructor failures after core listeners attach, without occupying a native slot", async () => {
    vi.useFakeTimers()
    let attempts = 0
    const create = createBrowserWorkerStartupFactory(() => {
      attempts += 1
      throw new Error("Injected constructor failure")
    })
    const clients = Array.from({ length: 3 }, () => new DocumentWorkerClient(create()))
    const outcomes = clients.map((client) =>
      client.request(request()).catch((error: unknown) => error),
    )
    expect(attempts).toBe(0)
    for (const outcome of await Promise.all(outcomes))
      expect(outcome).toMatchObject({ code: "worker-error" })
    expect(attempts).toBe(3)
    expect(vi.getTimerCount()).toBe(0)
    for (const client of clients) client.terminate()
  })

  it("expires an unstarted lease without constructing a worker after its deadline", async () => {
    const { create, natives } = setup()
    const client = new DocumentWorkerClient(create())
    const expired = client.request(request()).catch((error: unknown) => error)
    vi.advanceTimersByTime(120_000)
    expect(await expired).toMatchObject({ code: "worker-error" })
    await drain()
    expect(natives).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    client.terminate()
  })

  it("does not kill startup when sending health throws; a later native error releases it", async () => {
    vi.useFakeTimers()
    const native = new FakeWorker()
    native.rejectPosts = true
    const create = createBrowserWorkerStartupFactory(() => native)
    const client = new DocumentWorkerClient(create())
    await expect(client.request(request())).rejects.toMatchObject({ code: "worker-error" })
    expect(native.terminations).toBe(0)
    native.emit("error", new ErrorEvent("error", { message: "Worker failed" }))
    expect(native.terminations).toBe(1)
    expect(native.listenerCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    client.terminate()
  })

  it("rejects queued work and cleans up if native posting fails after health readiness", async () => {
    const { create, natives } = setup()
    const client = new DocumentWorkerClient(create())
    const rejected = client.request(request()).catch((error: unknown) => error)
    await drain()
    const native = at(natives)
    native.rejectPosts = true
    native.reply(health(native))
    expect(await rejected).toMatchObject({ code: "worker-error" })
    expect(native.terminations).toBe(1)
    expect(native.listenerCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    client.terminate()
  })
})
