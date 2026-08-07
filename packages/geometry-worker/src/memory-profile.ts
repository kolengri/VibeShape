import type { GeometryMemoryStage, KernelSpikeEngineResult } from "@vibeshape/protocol"

export type OpenCascadeMemoryModule = object & {
  HEAP8?: Int8Array
  VibeShapeAllocatorStats?: unknown
}

type AllocatorStatsBinding = {
  ArenaBytes: () => unknown
  AllocatedBytes: () => unknown
  FreeBytes: () => unknown
}

export function getWasmHeapBytes(opencascade: OpenCascadeMemoryModule | null) {
  return opencascade?.HEAP8?.byteLength ?? 0
}

function isAllocatorStatsBinding(value: unknown): value is AllocatorStatsBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "ArenaBytes") === "function" &&
    typeof Reflect.get(value, "AllocatedBytes") === "function" &&
    typeof Reflect.get(value, "FreeBytes") === "function"
  )
}

function requireMemoryByteCount(name: string, value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`OpenCascade allocator metric ${name} is invalid.`)
  }

  return Number(value)
}

function readAllocatorStatsBinding(opencascade: OpenCascadeMemoryModule) {
  const value: unknown = Reflect.get(opencascade, "VibeShapeAllocatorStats")

  if (value === undefined || value === null) {
    return null
  }

  if (!isAllocatorStatsBinding(value)) {
    throw new Error("OpenCascade allocator instrumentation binding is malformed.")
  }

  return value
}

export function createMemoryProfile(opencascade: OpenCascadeMemoryModule) {
  const allocatorStats = readAllocatorStatsBinding(opencascade)
  const memory: KernelSpikeEngineResult["memory"] = {
    source: allocatorStats ? "allocator-instrumented" : "heap-capacity-only",
    snapshots: [],
  }

  return {
    memory,
    capture(stage: GeometryMemoryStage) {
      const allocator = allocatorStats
        ? {
            arenaBytes: requireMemoryByteCount(
              "arenaBytes",
              Reflect.apply(allocatorStats.ArenaBytes, allocatorStats, []),
            ),
            allocatedBytes: requireMemoryByteCount(
              "allocatedBytes",
              Reflect.apply(allocatorStats.AllocatedBytes, allocatorStats, []),
            ),
            freeBytes: requireMemoryByteCount(
              "freeBytes",
              Reflect.apply(allocatorStats.FreeBytes, allocatorStats, []),
            ),
          }
        : null

      memory.snapshots.push({
        stage,
        heapCapacityBytes: getWasmHeapBytes(opencascade),
        allocator,
      })
    },
  }
}
