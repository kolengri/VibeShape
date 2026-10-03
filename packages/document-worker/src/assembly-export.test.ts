import type { AssemblyMaterializedOccurrence } from "@vibeshape/application/assembly-materialization"
import {
  assemblyDefinitionIdSchema,
  assemblyInstanceIdSchema,
  bodyReferenceSchema,
  createFeatureTypeRegistry,
  createModuleRegistry,
  featureIdSchema,
} from "@vibeshape/domain"
import { parseGeometryImport } from "@vibeshape/formats/import"
import { ReplicadGeometryEngine } from "@vibeshape/geometry-worker/engine"
import { inspectAssemblyInputSchema, printPreparationSettingsSchema } from "@vibeshape/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { exportAssemblyRuntime } from "./assembly-export"
import { withMaterializedAssemblyRuntime } from "./assembly-inspection"

const materialization = vi.hoisted(() => ({
  occurrences: [] as AssemblyMaterializedOccurrence[],
  contexts: new Map<string, string>(),
}))
vi.mock("./assembly-inspection", async (importOriginal) => {
  const original = await importOriginal<typeof import("./assembly-inspection")>()
  return {
    ...original,
    withMaterializedAssemblyRuntime: vi.fn(
      async (...args: Parameters<typeof original.withMaterializedAssemblyRuntime>) =>
        args[5](materialization.occurrences, materialization.contexts),
    ),
  }
})

const id = (n: number) => `0195b5ac-b220-7a2c-8c33-${n.toString(16).padStart(12, "0")}`
const contentHash = "a".repeat(64)
const vertices = [0, 0, 0, 20, 0, 0, 0, 20, 0, 0, 0, 20]
const triangles = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]
const identity = { documentId: id(1), revision: 4, generation: 0 }
const input = inspectAssemblyInputSchema.parse({
  authorityJson: "{}",
  sourceAssets: [],
  interferencePairs: [],
  mesh: { chordTolerance: 0.1, angularTolerance: 0.1 },
})
function registry() {
  const modules = createModuleRegistry([])
  if (!modules.ok) throw new Error("Test module registry failed.")
  const result = createFeatureTypeRegistry(modules.registry, [])
  if (!result.ok) throw new Error("Test feature registry failed.")
  return result.registry
}
function occurrence(
  instanceId: string,
  x: number,
  meshOnly = false,
): AssemblyMaterializedOccurrence {
  const mesh = {
    positions: new Float32Array(vertices.map((value, index) => value + (index % 3 === 0 ? x : 0))),
    normals: new Float32Array(vertices.length).fill(1),
    indices: new Uint32Array(triangles),
    triangleFaceIds: new Uint32Array(4).fill(1),
  }
  const bounds: AssemblyMaterializedOccurrence["bounds"] = { min: [x, 0, 0], max: [x + 20, 20, 20] }
  const body = bodyReferenceSchema.parse({
    schemaVersion: 0,
    featureId: id(2),
    outputRole: "result",
  })
  return {
    instanceId: assemblyInstanceIdSchema.parse(instanceId),
    definitionId: assemblyDefinitionIdSchema.parse(id(50)),
    pinRevision: 1,
    sourceIndex: 0,
    selectedBody: body,
    representation: meshOnly ? "triangle-mesh" : "exact-solid",
    geometryFrame: { translation: [x, 0, 0], quaternion: [0, 0, 0, 1] },
    bounds,
    mesh,
    geometry: {
      featureId: featureIdSchema.parse(id(2)),
      contentHash,
      outputRole: "result",
      mesh,
      shape: {
        valid: true,
        volume: meshOnly ? 0 : 8000 / 6,
        surfaceArea: 800,
        bounds,
        faceCount: meshOnly ? 0 : 4,
        edgeCount: meshOnly ? 0 : 6,
        solidCount: meshOnly ? 0 : 1,
      },
      topologyCandidates: [],
    },
  }
}
function exportWith(
  engine: ReplicadGeometryEngine,
  settings: Parameters<typeof exportAssemblyRuntime>[5],
) {
  return exportAssemblyRuntime(engine, registry(), null, input, identity, settings)
}
beforeEach(() => {
  vi.clearAllMocks()
  materialization.occurrences = [occurrence(id(60), 0), occurrence(id(61), 40)]
  materialization.contexts = new Map([[`${id(2)}:${contentHash}`, id(100)]])
})

describe("assembly export policy over verified world occurrences", () => {
  it("flattens selected world meshes into one STL stream in caller instance order", async () => {
    const before = structuredClone(materialization.occurrences)
    const result = await exportWith(new ReplicadGeometryEngine(), {
      format: "stl",
      instanceIds: [id(61), id(60)],
    })
    const view = new DataView(result.file.buffer, result.file.byteOffset, result.file.byteLength)
    expect(result.bodyCount).toBe(2)
    expect(view.getUint32(80, true)).toBe(8)
    expect(view.getFloat32(96, true)).toBe(40)
    expect(view.getFloat32(96 + 4 * 50, true)).toBe(0)
    expect(materialization.occurrences).toEqual(before)
    const parsed = await parseGeometryImport({ format: "stl", bytes: result.file, units: "mm" })
    expect(parsed.ok).toBe(true)
  })
  it("preserves stable occurrence labels and separate objects in interoperable 3MF", async () => {
    const result = await exportWith(new ReplicadGeometryEngine(), { format: "3mf" })
    const parsed = await parseGeometryImport({ format: "3mf", bytes: result.file })
    if (!parsed.ok) throw new Error(parsed.diagnostic.message)
    if (parsed.geometry.kind !== "triangle-mesh") throw new Error("Expected a mesh 3MF round trip.")
    expect(result.bodyCount).toBe(2)
    expect(parsed.geometry.meshes.map(({ label }) => label)).toEqual([`${id(60)}:0`, `${id(61)}:0`])
    expect(parsed.geometry.meshes[1]?.vertices.flat()).toContain(60)
  })
  it("passes selected native identities and poses without mutating callback-owned bytes", async () => {
    const engine = new ReplicadGeometryEngine()
    const bytes = new Uint8Array([1, 2, 3])
    const step = vi.spyOn(engine, "exportAssemblyStep").mockResolvedValue(bytes)
    const result = await exportWith(engine, { format: "step", instanceIds: [id(61)] })
    expect(step).toHaveBeenCalledWith([
      {
        documentId: id(100),
        featureId: id(2),
        contentHash,
        outputRole: "result",
        pose: { translation: [40, 0, 0], quaternion: [0, 0, 0, 1] },
      },
    ])
    expect(result.bodyCount).toBe(1)
    result.file[0] = 9
    expect(bytes[0]).toBe(1)
  })
  it("rejects lost selections, empty assemblies and unavailable native roles", async () => {
    const engine = new ReplicadGeometryEngine()
    await expect(exportWith(engine, { format: "stl", instanceIds: [id(99)] })).rejects.toThrow(
      /selection/,
    )
    materialization.contexts.clear()
    await expect(exportWith(engine, { format: "step" })).rejects.toThrow(/native source/)
    materialization.occurrences = []
    await expect(exportWith(engine, { format: "3mf" })).rejects.toThrow(/at least one/)
  })
  it("permits triangle meshes for print formats and rejects exact STEP claims", async () => {
    materialization.occurrences = [occurrence(id(60), 0, true)]
    const engine = new ReplicadGeometryEngine()
    const step = vi.spyOn(engine, "exportAssemblyStep")
    await expect(exportWith(engine, { format: "step" })).rejects.toThrow(/triangle meshes/)
    expect(step).not.toHaveBeenCalled()
    expect((await exportWith(engine, { format: "stl" })).bodyCount).toBe(1)
    expect((await exportWith(engine, { format: "3mf" })).bodyCount).toBe(1)
  })
  it("prepares one global placed print copy with warnings and preserves source arrays", async () => {
    const before = structuredClone(materialization.occurrences)
    const result = await exportWith(new ReplicadGeometryEngine(), {
      format: "3mf",
      printPreparation: printPreparationSettingsSchema.parse({ rotationX: 45 }),
    })
    expect(result.bodyCount).toBe(2)
    expect(result.printPreparation?.report.warnings).toContain("multiple-bodies")
    expect(result.printPreparation?.meshes[0]?.vertices).not.toEqual(
      Array.from(before[0]?.mesh.positions ?? []),
    )
    expect(materialization.occurrences).toEqual(before)
    const parsed = await parseGeometryImport({ format: "3mf", bytes: result.file })
    expect(parsed.ok).toBe(true)
  })
  it("enforces the existing eight-body preparation budget without limiting plain 3MF", async () => {
    materialization.occurrences = Array.from({ length: 9 }, (_, index) =>
      occurrence(id(60 + index), index * 40),
    )
    const engine = new ReplicadGeometryEngine()
    await expect(
      exportWith(engine, {
        format: "3mf",
        printPreparation: printPreparationSettingsSchema.parse({}),
      }),
    ).rejects.toThrow(/eight source bodies/)
    expect((await exportWith(engine, { format: "3mf" })).bodyCount).toBe(9)
  })
  it("rejects hostile settings and interference input before native materialization", async () => {
    const engine = new ReplicadGeometryEngine()
    await expect(exportWith(engine, { format: "stl", instanceIds: [] })).rejects.toThrow()
    await expect(
      exportWith(engine, { format: "stl", instanceIds: [id(60), id(60)] }),
    ).rejects.toThrow()
    await expect(
      exportAssemblyRuntime(
        engine,
        registry(),
        null,
        {
          ...input,
          interferencePairs: [{ leftInstanceId: id(60), rightInstanceId: id(61) }],
        },
        identity,
        { format: "stl" },
      ),
    ).rejects.toThrow()
    expect(withMaterializedAssemblyRuntime).not.toHaveBeenCalled()
  })
  it("rejects empty or oversized native files instead of returning partial export evidence", async () => {
    const engine = new ReplicadGeometryEngine()
    const step = vi.spyOn(engine, "exportAssemblyStep").mockResolvedValue(new Uint8Array())
    await expect(exportWith(engine, { format: "step" })).rejects.toThrow(/invalid or oversized/)
    step.mockResolvedValue(new Uint8Array(64 * 1024 * 1024 + 1))
    await expect(exportWith(engine, { format: "step" })).rejects.toThrow(/invalid or oversized/)
  })
})
