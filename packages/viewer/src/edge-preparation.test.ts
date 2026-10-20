import { describe, expect, it } from "bun:test"
import { BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, SphereGeometry } from "three"
import { edgePreparationFixture, ManualEdgeWorker } from "../tests/edge-preparation-fixture"
import { EdgePreparationCancelledError, EdgePreparationClient } from "./edge-preparation"
import { processEdgePreparation } from "./edge-preparation-runtime"
import type { EdgePreparationRequest } from "./edge-preparation-schema"

function request(geometry: BufferGeometry): EdgePreparationRequest {
  const position = geometry.getAttribute("position")
  return {
    version: 1,
    type: "prepareEdges",
    jobId: 1,
    positions: new Float32Array(position.array),
    indices: geometry.index
      ? new Uint32Array(geometry.index.array)
      : Uint32Array.from({ length: position.count }, (_, index) => index),
  }
}

function crease(degrees: number) {
  const angle = (degrees * Math.PI) / 180
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -Math.cos(angle), Math.sin(angle)]),
      3,
    ),
  )
  geometry.setIndex([0, 1, 2, 1, 0, 3])
  return geometry
}

const triangle = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
}

describe("worker crease-edge equivalence and validation", () => {
  it.each([
    ["box", () => new BoxGeometry()],
    ["smooth sphere", () => new SphereGeometry(1, 64, 32)],
    ["open triangles", () => crease(20).toNonIndexed()],
    ["below threshold", () => crease(27.99)],
    ["above threshold", () => crease(28.01)],
  ] as const)("matches stock Three at 28 degrees exactly for %s", (_name, create) => {
    const geometry = create()
    const reference = new EdgesGeometry(geometry, 28)
    try {
      const result = processEdgePreparation(request(geometry))
      expect(result.type).toBe("edgesPrepared")
      if (result.type !== "edgesPrepared") throw new Error("Expected prepared edges.")
      expect(Array.from(result.positions)).toEqual(
        Array.from(reference.getAttribute("position").array),
      )
    } finally {
      reference.dispose()
      geometry.dispose()
    }
  })

  it("preserves the crease threshold, empty meshes, and degenerate triangles", () => {
    for (const [degrees, edgeCount] of [
      [27.99, 4],
      [28.01, 5],
    ]) {
      const geometry = crease(degrees ?? 0)
      const result = processEdgePreparation(request(geometry))
      if (result.type !== "edgesPrepared") throw new Error("Expected prepared edges.")
      expect(result.positions.length).toBe((edgeCount ?? 0) * 6)
      geometry.dispose()
    }
    for (const source of [
      { positions: new Float32Array(), indices: new Uint32Array() },
      { ...triangle, indices: new Uint32Array([0, 0, 1]) },
    ]) {
      const result = processEdgePreparation({
        version: 1,
        type: "prepareEdges",
        jobId: 1,
        ...source,
      })
      expect(result.type === "edgesPrepared" && result.positions.length).toBe(0)
    }
  })

  it.each([
    null,
    { version: 2, type: "prepareEdges", jobId: 1, ...triangle },
    { version: 1, type: "prepareEdges", jobId: 1, ...triangle, extra: true },
    { version: 1, type: "prepareEdges", jobId: 1, ...triangle, positions: [0, 0, 0] },
    { version: 1, type: "prepareEdges", jobId: 1, ...triangle, positions: new Float32Array(2) },
    {
      version: 1,
      type: "prepareEdges",
      jobId: 1,
      ...triangle,
      indices: new Uint32Array([9, 0, 1]),
    },
    {
      version: 1,
      type: "prepareEdges",
      jobId: 1,
      ...triangle,
      positions: new Float32Array([NaN, 0, Infinity]),
    },
  ])("rejects invalid worker input %#", (value) => {
    expect(processEdgePreparation(value).type).toBe("edgePreparationFailed")
  })
})

describe("edge worker client lifecycle", () => {
  it("runs the production module-worker entry with native transfers", async () => {
    const errors: Error[] = []
    const client = new EdgePreparationClient(
      () =>
        new Worker(new URL("./edge-preparation.worker.ts", import.meta.url), { type: "module" }),
      (error) => errors.push(error),
    )
    try {
      expect((await client.prepare({}, triangle).result).length).toBe(18)
      expect(triangle.positions.byteLength).toBe(36)
      expect(triangle.indices.byteLength).toBe(12)
      expect(errors).toEqual([])
    } finally {
      client.dispose()
    }
  })

  it("starts lazily, transfers safe copies, serializes jobs, and reuses its worker", async () => {
    const state = edgePreparationFixture()
    expect(state.creations).toBe(0)
    const first = state.client.prepare({}, triangle)
    const second = state.client.prepare({}, triangle)
    expect(state.creations).toBe(1)
    expect(state.worker.requests.length).toBe(1)
    expect(state.worker.requests[0]?.positions).toEqual(triangle.positions)
    expect(state.worker.requests[0]?.positions).not.toBe(triangle.positions)
    expect(state.worker.transfers[0]?.map((buffer) => buffer.byteLength)).toEqual([0, 0])
    expect(triangle.positions.byteLength).toBe(36)
    expect(triangle.indices.byteLength).toBe(12)
    state.worker.complete()
    expect((await first.result).length).toBe(18)
    expect(state.worker.requests.length).toBe(2)
    state.worker.complete(1)
    await second.result
    expect(state.creations).toBe(1)
    state.client.dispose()
    expect(state.worker.terminated).toBe(true)
    expect(state.errors).toEqual([])
  })

  it("keeps only the latest queued owner and discards a cancelled active result", async () => {
    const state = edgePreparationFixture()
    const owner = {}
    const active = state.client.prepare(owner, triangle)
    const oldQueued = state.client.prepare(owner, triangle)
    const latest = state.client.prepare(owner, {
      ...triangle,
      positions: new Float32Array(triangle.positions.map((value) => value * 2)),
    })
    await expect(active.result).rejects.toBeInstanceOf(EdgePreparationCancelledError)
    await expect(oldQueued.result).rejects.toBeInstanceOf(EdgePreparationCancelledError)
    expect(state.worker.requests.length).toBe(1)
    state.worker.complete()
    expect(state.worker.requests.length).toBe(2)
    expect(state.worker.requests[1]?.positions[3]).toBe(2)
    state.worker.complete(1)
    expect((await latest.result)[3]).toBe(2)
    state.client.dispose()
  })

  it("removes cancelled queued jobs before copying or dispatching", async () => {
    const state = edgePreparationFixture()
    const active = state.client.prepare({}, triangle)
    const removed = state.client.prepare({}, triangle)
    removed.cancel()
    await expect(removed.result).rejects.toBeInstanceOf(EdgePreparationCancelledError)
    state.worker.complete()
    await active.result
    expect(state.worker.requests.length).toBe(1)
    state.client.dispose()
  })

  it.each(["error", "messageerror", "invalid", "stale", "oversized", "failure"])(
    "settles active and queued jobs on %s, with no retry or synchronous fallback",
    async (kind) => {
      const state = edgePreparationFixture()
      const first = state.client.prepare({}, triangle)
      const second = state.client.prepare({}, triangle)
      const settled = Promise.allSettled([first.result, second.result])
      const jobId = state.worker.requests[0]?.jobId ?? 1
      if (kind === "error" || kind === "messageerror") state.worker.dispatchEvent(new Event(kind))
      else if (kind === "invalid") state.worker.respond({ version: 2 })
      else if (kind === "failure")
        state.worker.respond({
          version: 1,
          type: "edgePreparationFailed",
          jobId,
          code: "preparation-failed",
        })
      else
        state.worker.respond({
          version: 1,
          type: "edgesPrepared",
          jobId: kind === "stale" ? jobId + 1 : jobId,
          positions: new Float32Array(24),
        })
      expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"])
      expect(state.worker.terminated).toBe(true)
      expect(state.errors.length).toBe(1)
      await expect(state.client.prepare({}, triangle).result).rejects.toBeInstanceOf(Error)
      expect(state.creations).toBe(1)
      state.client.dispose()
    },
  )

  it("settles worker construction failures and disposal, ignoring late events", async () => {
    const errors: Error[] = []
    const broken = new EdgePreparationClient(
      () => {
        throw new Error("Unavailable worker.")
      },
      (error) => errors.push(error),
    )
    await expect(broken.prepare({}, triangle).result).rejects.toThrow("Could not start")
    expect(errors.length).toBe(1)
    broken.dispose()
    const state = edgePreparationFixture()
    const active = state.client.prepare({}, triangle)
    const queued = state.client.prepare({}, triangle)
    const settled = Promise.allSettled([active.result, queued.result])
    state.client.dispose()
    state.client.dispose()
    state.worker.complete()
    expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"])
    expect(state.worker.requests.length).toBe(1)
    expect(state.errors.length).toBe(0)
    await expect(state.client.prepare({}, triangle).result).rejects.toBeInstanceOf(
      EdgePreparationCancelledError,
    )
  })

  it("settles dispatch failures and terminates the partially started worker", async () => {
    const worker = new ManualEdgeWorker()
    worker.postMessage = () => {
      throw new Error("Transfer failed.")
    }
    const errors: Error[] = []
    const client = new EdgePreparationClient(
      () => worker,
      (error) => errors.push(error),
    )
    await expect(client.prepare({}, triangle).result).rejects.toThrow("Could not start")
    expect(worker.terminated).toBe(true)
    expect(errors.length).toBe(1)
    client.dispose()
  })
})
