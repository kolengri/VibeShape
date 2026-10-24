import { describe, expect, it } from "bun:test"
import { BoxGeometry, type BufferGeometry, SphereGeometry } from "three"
import { ManualSectionCapWorker } from "../tests/section-cap-worker-fixture"
import { sectionCapPositions } from "./section-cap"
import { SectionCapClient, type SectionCapWorker } from "./section-cap-client"
import { SectionCapRuntime } from "./section-cap-runtime"
import type { ViewerSection } from "./section-view"

function source(geometry: BufferGeometry = new BoxGeometry(10, 10, 10)) {
  const positions = new Float32Array(geometry.getAttribute("position").array)
  const indices = geometry.index
    ? new Uint32Array(geometry.index.array)
    : Uint32Array.from({ length: positions.length / 3 }, (_, index) => index)
  geometry.dispose()
  return { positions, indices }
}

function fixture() {
  const workers: ManualSectionCapWorker[] = []
  const errors: Error[] = []
  const received: (readonly (Float32Array | null)[])[] = []
  const client = new SectionCapClient(
    () => {
      const worker = new ManualSectionCapWorker()
      workers.push(worker)
      return worker
    },
    (error) => errors.push(error),
  )
  const receive = (caps: readonly (Float32Array | null)[]) => received.push(caps)
  return { client, workers, errors, received, receive }
}

const section: ViewerSection = { axis: "z", offset: 0, flipped: false }

function rejectSectionRequest(worker: ManualSectionCapWorker, kind: string) {
  if (kind === "error" || kind === "messageerror") {
    worker.dispatchEvent(new Event(kind))
    return
  }
  if (kind === "invalid") {
    worker.respond({ version: 2 })
    return
  }
  if (kind === "failure") {
    worker.respond({
      version: 1,
      type: "sectionCapsFailed",
      jobId: 1,
      code: "computation-failed",
    })
    return
  }
  const invalidCaps: Record<string, Float32Array[]> = {
    count: [],
    oversized: [new Float32Array(225)],
    empty: [new Float32Array(0)],
    nonfinite: [new Float32Array(9).fill(NaN)],
  }
  worker.respond({
    version: 1,
    type: "sectionCapsComputed",
    jobId: kind === "job" ? 2 : 1,
    caps: invalidCaps[kind] ?? [new Float32Array(9).fill(NaN)],
  })
}

describe("section cap worker boundary", () => {
  it("starts lazily and transfers one safe scene copy across all offset, axis, and flip updates", () => {
    const f = fixture()
    const mesh = source()
    const before = structuredClone(mesh)
    f.client.setSources([mesh])
    expect(f.workers).toHaveLength(0)
    f.client.compute(section, f.receive)
    const worker = f.workers[0]
    if (!worker) throw new Error("Expected a lazy worker.")
    for (let offset = 1; offset <= 100; offset += 1)
      f.client.compute({ axis: offset % 2 ? "x" : "y", offset, flipped: true }, f.receive)
    const latest: ViewerSection = { axis: "x", offset: 2, flipped: true }
    f.client.compute(latest, f.receive)
    expect(worker.requests).toHaveLength(1)
    expect(worker.requests[0]?.sources?.[0]).toEqual(before)
    expect(worker.transfers[0]?.map((buffer) => buffer.byteLength)).toEqual([0, 0])
    expect(mesh).toEqual(before)
    worker.complete()
    expect(f.received).toEqual([])
    expect(worker.requests).toHaveLength(2)
    expect(worker.requests[1]?.section).toEqual(latest)
    expect(worker.requests[1]?.sources).toBeNull()
    expect(worker.transfers[1]).toEqual([])
    worker.complete(1)
    expect(f.received).toEqual([[sectionCapPositions(mesh, latest)]])
    expect(
      worker.outputTransfers.every((buffers) => buffers.every((buffer) => !buffer.byteLength)),
    ).toBe(true)
    f.client.compute(section, f.receive)
    worker.complete(2)
    expect(f.workers).toHaveLength(1)
    expect(f.received).toHaveLength(2)
    expect(mesh).toEqual(before)
    expect(f.errors).toEqual([])
    f.client.dispose()
  })

  it("terminates old snapshots on replacement and disable, ignores late replies, and recreates lazily", () => {
    const f = fixture()
    f.client.setSources([source()])
    f.client.compute(section, f.receive)
    f.client.compute({ ...section, offset: 1 }, f.receive)
    const old = f.workers[0]
    const replacement = source(new BoxGeometry(20, 20, 20))
    f.client.setSources([replacement])
    expect(old?.terminated).toBe(true)
    expect(f.workers).toHaveLength(1)
    old?.complete()
    expect(f.received).toEqual([])
    f.client.compute(section, f.receive)
    f.workers[1]?.complete()
    expect(f.received).toEqual([[sectionCapPositions(replacement, section)]])
    f.client.compute({ ...section, offset: 2 }, f.receive)
    f.client.clear()
    expect(f.workers[1]?.terminated).toBe(true)
    f.workers[1]?.complete(1)
    expect(f.received).toHaveLength(1)
    f.client.compute(section, f.receive)
    f.workers[2]?.complete()
    expect(f.received).toHaveLength(2)
    f.client.dispose()
  })

  it("disposes active and queued work without callbacks, restart, or retained listeners", () => {
    const f = fixture()
    f.client.setSources([source()])
    f.client.compute(section, f.receive)
    f.client.compute({ ...section, offset: 1 }, f.receive)
    f.client.dispose()
    f.client.dispose()
    f.workers[0]?.complete()
    f.workers[0]?.dispatchEvent(new Event("error"))
    f.client.setSources([source()])
    f.client.compute(section, f.receive)
    expect(f.workers).toHaveLength(1)
    expect(f.workers[0]?.terminated).toBe(true)
    expect(f.received).toEqual([])
    expect(f.errors).toEqual([])
  })

  it.each([
    "error",
    "messageerror",
    "invalid",
    "job",
    "count",
    "oversized",
    "nonfinite",
    "empty",
    "failure",
  ])(
    "reports %s once, drops all work, and retries only after resetting the source lifecycle",
    (kind) => {
      const f = fixture()
      f.client.setSources([source()])
      f.client.compute(section, f.receive)
      f.client.compute({ ...section, offset: 1 }, f.receive)
      const worker = f.workers[0]
      if (!worker) throw new Error("Expected an active worker.")
      rejectSectionRequest(worker, kind)
      expect(f.errors).toHaveLength(1)
      expect(f.received).toEqual([])
      expect(worker.terminated).toBe(true)
      worker.complete()
      f.client.compute(section, f.receive)
      expect(f.workers).toHaveLength(1)
      f.client.setSources([source()])
      f.client.compute(section, f.receive)
      f.workers[1]?.complete()
      expect(f.received).toHaveLength(1)
      f.client.dispose()
    },
  )

  it("contains worker construction and transfer failures without promises or synchronous fallback", () => {
    for (const dispatch of [false, true]) {
      const worker = new ManualSectionCapWorker()
      worker.postMessage = () => {
        throw new Error("Transfer failed.")
      }
      const errors: Error[] = []
      const client = new SectionCapClient(
        () => {
          if (!dispatch) throw new Error("Worker unavailable.")
          return worker
        },
        (error) => errors.push(error),
      )
      client.setSources([source()])
      let received = false
      client.compute(section, () => {
        received = true
      })
      expect(errors[0]?.message).toBe("Could not start section cap computation.")
      expect(received).toBe(false)
      expect(worker.terminated).toBe(dispatch)
      client.dispose()
    }
  })

  it("rejects malformed requests and missing snapshots at the production runtime", () => {
    const runtime = new SectionCapRuntime()
    const request = {
      version: 1,
      type: "computeSectionCaps",
      jobId: 1,
      section,
      sources: [source()],
    }
    for (const value of [
      null,
      undefined,
      1,
      {},
      { ...request, version: 2 },
      { ...request, jobId: 0 },
      { ...request, section: { ...section, axis: "w" } },
      { ...request, section: { ...section, offset: NaN } },
      { ...request, section: { ...section, offset: Infinity } },
      { ...request, section: { ...section, flipped: 1 } },
      { ...request, sources: [{ positions: [], indices: [] }] },
      { ...request, sources: [{ positions: new Float32Array(2), indices: new Uint32Array() }] },
    ])
      expect(runtime.process(value)).toEqual({
        version: 1,
        type: "sectionCapsFailed",
        jobId: 0,
        code: "invalid-request",
      })
    expect(runtime.process({ ...request, sources: null })).toEqual({
      version: 1,
      type: "sectionCapsFailed",
      jobId: 1,
      code: "missing-sources",
    })
  })

  it("runs the native module worker with real transfers and leaves render buffers attached", async () => {
    const mesh = source(new SphereGeometry(5, 128, 64))
    const before = structuredClone(mesh)
    const transferred: ArrayBuffer[] = []
    let client: SectionCapClient | undefined
    try {
      const caps = await new Promise<readonly (Float32Array | null)[]>((resolve, reject) => {
        client = new SectionCapClient(() => {
          const worker = new Worker(new URL("./section-cap.worker.ts", import.meta.url), {
            type: "module",
          })
          const port: SectionCapWorker = {
            postMessage(request, transfer) {
              worker.postMessage(request, transfer)
              transferred.push(...transfer)
            },
            addEventListener: (type, listener) => worker.addEventListener(type, listener),
            removeEventListener: (type, listener) => worker.removeEventListener(type, listener),
            terminate: () => {
              worker.terminate()
            },
          }
          return port
        }, reject)
        client.setSources([mesh])
        client.compute(section, resolve)
      })
      expect(caps).toEqual([sectionCapPositions(mesh, section)])
      expect(caps[0]?.buffer.byteLength).toBeGreaterThan(0)
      expect(transferred.map((buffer) => buffer.byteLength)).toEqual([0, 0])
      expect(mesh).toEqual(before)
    } finally {
      client?.dispose()
    }
  })
})
