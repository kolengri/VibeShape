import { describe, expect, it, spyOn } from "bun:test"
import { extrusionBodyFixture } from "../features/extrusion/extrusion-body-test-fixtures"
import {
  AssistantCheckpointBaselines,
  measureCheckpointBaseline,
} from "./assistant-checkpoint-baselines"

const handle = () => ({ id: Symbol("checkpoint") })
function baseline(owner = {}, elements = 6_144) {
  const seed = extrusionBodyFixture(undefined, false, "PLANE")
  if (!seed.rebuild.ok) throw new Error("Expected baseline geometry.")
  const geometry = seed.rebuild.response.geometry[0]?.geometry
  if (!geometry) throw new Error("Expected feature geometry.")
  const mesh = {
    positions: new Float32Array(elements),
    normals: new Float32Array(elements),
    indices: new Uint32Array([0, 1, 2]),
    triangleFaceIds: new Uint32Array([1]),
  }
  geometry.mesh = mesh
  for (const body of geometry.bodies ?? []) body.mesh = mesh
  return {
    session: owner,
    snapshot: "captured model",
    authority: "captured authority",
    rebuild: seed.rebuild.response,
  }
}

describe("checkpoint baseline retention budget", () => {
  it("charges unique full backing buffers rather than repeated views or just view lengths", () => {
    const value = baseline()
    const buffer = new ArrayBuffer(256)
    const geometry = value.rebuild.geometry[0]?.geometry
    if (!geometry) throw new Error("Expected geometry.")
    geometry.mesh = {
      positions: new Float32Array(buffer, 0, 3),
      normals: new Float32Array(buffer, 12, 3),
      indices: new Uint32Array(buffer, 24, 3),
      triangleFaceIds: new Uint32Array(buffer, 36, 1),
    }
    for (const body of geometry.bodies ?? []) body.mesh = geometry.mesh
    expect(measureCheckpointBaseline(value).bufferBytes).toBe(256)
  })

  it("accounts for plain topology arrays and strings without serializing geometry", () => {
    const value = baseline()
    const before = measureCheckpointBaseline(value)
    const candidate = value.rebuild.geometry[0]?.geometry.topologyCandidates[0]
    if (!candidate) throw new Error("Expected topology.")
    candidate.lineageTokens = Array.from({ length: 100 }, () => "x".repeat(200))
    const after = measureCheckpointBaseline(value)
    expect(after.bufferBytes).toBe(before.bufferBytes)
    expect(after.heapBytes - before.heapBytes).toBeGreaterThan(40_000)
    expect(after.complete).toBe(true)
  })

  it("evicts the oldest cache copy while retaining independent buffers within the budget", () => {
    const cache = new AssistantCheckpointBaselines(64 * 1024)
    const first = handle(),
      second = handle()
    const source = baseline()
    expect(cache.set(first, source)).toBe(true)
    expect(cache.set(second, source)).toBe(true)
    expect(cache.get(first)).toBeUndefined()
    expect(cache.size).toBe(1)
    expect(cache.retainedBytes).toBeLessThanOrEqual(64 * 1024)
    source.rebuild.geometry[0]?.geometry.mesh.positions.fill(123)
    expect(cache.get(second)?.rebuild.geometry[0]?.geometry.mesh.positions[0]).toBe(0)
  })

  it("declines an oversized entry before cloning and preserves useful existing entries", () => {
    const cache = new AssistantCheckpointBaselines(64 * 1024)
    const first = handle()
    expect(cache.set(first, baseline())).toBe(true)
    const clone = spyOn(globalThis, "structuredClone")
    try {
      expect(cache.set(handle(), baseline({}, 20_480))).toBe(false)
      expect(clone).not.toHaveBeenCalled()
      expect(cache.get(first)).toBeDefined()
      expect(cache.size).toBe(1)
    } finally {
      clone.mockRestore()
    }
  })

  it("pins a presented or preparing baseline instead of evicting its still-live buffers", () => {
    const source = baseline()
    const presented = handle()
    let pinned = false
    const active = new AssistantCheckpointBaselines(
      64 * 1024,
      (candidate) => pinned && candidate === presented,
    )
    expect(active.set(presented, source)).toBe(true)
    pinned = true
    expect(active.set(handle(), source)).toBe(false)
    expect(active.get(presented)).toBeDefined()
    expect(active.size).toBe(1)
  })

  it("reclaims accounting on release, owner replacement and teardown", () => {
    const owner = {},
      replacement = {}
    const cache = new AssistantCheckpointBaselines(64 * 1024)
    const first = handle()
    expect(cache.set(first, baseline(owner))).toBe(true)
    cache.delete(first)
    expect(cache.retainedBytes).toBe(0)
    expect(cache.set(handle(), baseline(owner))).toBe(true)
    cache.pruneOwner(replacement)
    expect(cache.size).toBe(0)
    expect(cache.retainedBytes).toBe(0)
    expect(cache.set(handle(), baseline(replacement))).toBe(true)
    cache.clear()
    expect(cache.retainedBytes).toBe(0)
  })
})
