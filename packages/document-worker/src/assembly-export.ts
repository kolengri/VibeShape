import type { AssemblyMaterializedOccurrence } from "@vibeshape/application/assembly-materialization"
import type { FeatureTypeRegistry } from "@vibeshape/domain"
import type { AssemblyConstraintSolvePort } from "@vibeshape/domain/assembly-mates"
import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import { writeThreeMfMeshes } from "@vibeshape/formats/three-mf-meshes"
import type { AssemblyNativeBody, GeometryKernelEngine } from "@vibeshape/geometry-worker/engine"
import { preparePrintMeshes } from "@vibeshape/print-analysis"
import {
  type AssemblyExportSettings,
  exportAssemblyInputSchema,
  type InspectAssemblyInput,
  type PrintPreparationResult,
} from "@vibeshape/protocol"
import { assemblyNativeBodies, withMaterializedAssemblyRuntime } from "./assembly-inspection"
import type { SketchSolvePort } from "./external-sketch-references"

type StepPort = {
  exportAssemblyStep?: (sources: readonly AssemblyNativeBody[]) => Promise<Uint8Array>
}
export type AssemblyExportResult = Readonly<{
  file: Uint8Array
  bodyCount: number
  printPreparation?: PrintPreparationResult
}>
function selectedOccurrences(
  occurrences: readonly AssemblyMaterializedOccurrence[],
  ids?: readonly string[],
) {
  if (!occurrences.length) throw new Error("Select at least one assembly instance to export.")
  if (!ids) return occurrences
  return ids.flatMap((id) => {
    const bodies = occurrences.filter(({ instanceId }) => instanceId === id)
    if (!bodies.length) throw new Error("An assembly export selection no longer exists.")
    return bodies
  })
}
function worldMeshes(occurrences: readonly AssemblyMaterializedOccurrence[]) {
  return occurrences.map((source) => ({
    name: `${source.instanceId}:${source.sourceIndex}`,
    vertices: Array.from(source.mesh.positions),
    triangles: Array.from(source.mesh.indices),
  }))
}
function combinedStl(meshes: ReturnType<typeof worldMeshes>) {
  const vertices: number[] = [],
    triangles: number[] = []
  for (const mesh of meshes) {
    const offset = vertices.length / 3
    for (const value of mesh.vertices) vertices.push(value)
    for (const index of mesh.triangles) triangles.push(index + offset)
  }
  return writeStlMeshes([{ vertices, triangles }])
}
function checkedFile(file: unknown): Uint8Array {
  if (!(file instanceof Uint8Array) || file.byteLength === 0 || file.byteLength > 64 * 1024 * 1024)
    throw new Error("Assembly export produced an invalid or oversized file.")
  return Uint8Array.from(file)
}

async function exportStep(
  engine: GeometryKernelEngine & StepPort,
  selected: readonly AssemblyMaterializedOccurrence[],
  contexts: ReadonlyMap<string, string>,
): Promise<AssemblyExportResult> {
  if (selected.some(({ representation }) => representation !== "exact-solid"))
    throw new Error(
      "STEP export requires exact assembly sources; triangle meshes support STL or 3MF.",
    )
  if (!engine.exportAssemblyStep) throw new Error("Exact assembly STEP export is unavailable.")
  return {
    file: checkedFile(await engine.exportAssemblyStep(assemblyNativeBodies(selected, contexts))),
    bodyCount: selected.length,
  }
}
function assertPrintMeshBudget(meshes: ReturnType<typeof worldMeshes>) {
  if (
    meshes.length > 4096 ||
    meshes.reduce((sum, mesh) => sum + (mesh.vertices.length + mesh.triangles.length) * 4, 0) >
      64 * 1024 * 1024
  )
    throw new Error("The assembly print copy exceeds its geometry resource budget.")
}
function exportThreeMf(
  meshes: ReturnType<typeof worldMeshes>,
  bodyCount: number,
  settings: AssemblyExportSettings["printPreparation"],
): AssemblyExportResult {
  if (settings && meshes.length > 8)
    throw new Error(
      "Assembly print preparation supports up to eight source bodies. Export 3MF without preparation for a larger selection.",
    )
  const printPreparation = settings ? preparePrintMeshes({ meshes, settings }) : undefined
  const prepared = printPreparation?.meshes ?? meshes
  assertPrintMeshBudget(prepared)
  const file = writeThreeMfMeshes({
    title: "VibeShape assembly",
    meshes: prepared,
    assembly: prepared.length > 1 || Boolean(printPreparation),
  }).bytes
  return { file: checkedFile(file), bodyCount, ...(printPreparation ? { printPreparation } : {}) }
}

/** Exports a disposable placed copy; the document and native source caches retain their original coordinates. */
export async function exportAssemblyRuntime(
  engine: GeometryKernelEngine & StepPort,
  registry: FeatureTypeRegistry,
  solveSketch: SketchSolvePort | null,
  input: InspectAssemblyInput,
  identity: { documentId: string; revision: number; generation: number },
  settings: AssemblyExportSettings,
  solveAssemblyConstraints?: AssemblyConstraintSolvePort,
): Promise<AssemblyExportResult> {
  const request = exportAssemblyInputSchema.parse({ assembly: input, settings })
  return withMaterializedAssemblyRuntime(
    engine,
    registry,
    solveSketch,
    request.settings.meshQuality
      ? { ...request.assembly, mesh: request.settings.meshQuality }
      : request.assembly,
    identity,
    async (occurrences, contexts) => {
      const selected = selectedOccurrences(occurrences, request.settings.instanceIds)
      if (request.settings.format === "step") return exportStep(engine, selected, contexts)
      const meshes = worldMeshes(selected)
      if (request.settings.format === "stl")
        return { file: checkedFile(combinedStl(meshes)), bodyCount: selected.length }
      return exportThreeMf(meshes, selected.length, request.settings.printPreparation)
    },
    solveAssemblyConstraints,
  )
}
