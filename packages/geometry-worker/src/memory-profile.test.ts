import { describe, expect, it } from "vitest"
import { createMemoryProfile, getWasmHeapBytes } from "./memory-profile"

describe("geometry worker memory profiling", () => {
  it("reports heap capacity when the published binding has no allocator instrumentation", () => {
    const profiler = createMemoryProfile({ HEAP8: new Int8Array(64) })

    profiler.capture("initialized")

    expect(profiler.memory).toEqual({
      source: "heap-capacity-only",
      snapshots: [
        {
          stage: "initialized",
          heapCapacityBytes: 64,
          allocator: null,
        },
      ],
    })
  })

  it("captures allocator bytes when the controlled binding exposes all metrics", () => {
    const profiler = createMemoryProfile({
      HEAP8: new Int8Array(128),
      VibeShapeAllocatorStats: {
        ArenaBytes: () => 96,
        AllocatedBytes: () => 64,
        FreeBytes: () => 32,
      },
    })

    profiler.capture("validation-completed")

    expect(profiler.memory).toEqual({
      source: "allocator-instrumented",
      snapshots: [
        {
          stage: "validation-completed",
          heapCapacityBytes: 128,
          allocator: { arenaBytes: 96, allocatedBytes: 64, freeBytes: 32 },
        },
      ],
    })
  })

  it.each([
    null,
    {},
    { ArenaBytes: () => 1 },
    { ArenaBytes: 1, AllocatedBytes: () => 1, FreeBytes: () => 1 },
  ])("rejects a present but malformed allocator binding: %o", (binding) => {
    if (binding === null) {
      expect(createMemoryProfile({ VibeShapeAllocatorStats: binding }).memory.source).toBe(
        "heap-capacity-only",
      )
      return
    }

    expect(() => createMemoryProfile({ VibeShapeAllocatorStats: binding })).toThrow(
      "OpenCascade allocator instrumentation binding is malformed.",
    )
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "rejects an invalid allocator byte count: %s",
    (allocatedBytes) => {
      const profiler = createMemoryProfile({
        VibeShapeAllocatorStats: {
          ArenaBytes: () => 1,
          AllocatedBytes: () => allocatedBytes,
          FreeBytes: () => 0,
        },
      })

      expect(() => profiler.capture("initialized")).toThrow(
        "OpenCascade allocator metric allocatedBytes is invalid.",
      )
    },
  )

  it("reports zero when no Emscripten heap view is available", () => {
    expect(getWasmHeapBytes({})).toBe(0)
    expect(getWasmHeapBytes(null)).toBe(0)
  })
})
