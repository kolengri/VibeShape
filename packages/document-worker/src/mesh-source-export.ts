import type { FeatureRebuildState } from "@vibeshape/application/feature-rebuild"
import { terminalBodyGeometry } from "@vibeshape/application/model-bodies"
import { writeStlMeshes } from "@vibeshape/formats/stl-meshes"
import type {
  DocumentPrintMeshExportInput,
  GeometryKernelEngine,
} from "@vibeshape/geometry-worker/engine"
import type { FeatureEvaluationDependency } from "@vibeshape/protocol"

function key(body: { featureId: string; outputRole?: string | undefined }) {
  return `${body.featureId}:${body.outputRole ?? "result"}`
}
function validateTextureTargets(
  exact: readonly FeatureEvaluationDependency[],
  options: Pick<DocumentPrintMeshExportInput, "surfaceTextures" | "textureQuality"> | undefined,
) {
  const exactKeys = new Set(exact.map(key))
  if (
    options?.surfaceTextures?.some(
      (group) => group.layers.some((layer) => layer.enabled) && !exactKeys.has(key(group)),
    )
  )
    throw new Error(
      "Surface relief requires a selected exact solid body. Repair the texture target.",
    )
}
export function exportIncludesMesh(
  state: FeatureRebuildState,
  features: readonly FeatureEvaluationDependency[],
) {
  const meshes = new Set(
    (terminalBodyGeometry(state) ?? [])
      .filter((body) => body.representation === "triangle-mesh")
      .map(key),
  )
  return features.some((feature) => meshes.has(key(feature)))
}
/** Keeps native tessellation and authored mesh occurrences in the caller's exact selection order. */
export async function collectDocumentPrintMeshes(
  engine: GeometryKernelEngine,
  documentId: string,
  state: FeatureRebuildState,
  features: readonly FeatureEvaluationDependency[],
  textureOptions?: Pick<DocumentPrintMeshExportInput, "surfaceTextures" | "textureQuality">,
) {
  const bodies = terminalBodyGeometry(state)
  if (!bodies) throw new Error("Current terminal body geometry is unavailable.")
  const byKey = new Map(bodies.map((body) => [key(body), body]))
  const exact = features.filter(
    (feature) => byKey.get(key(feature))?.representation !== "triangle-mesh",
  )
  validateTextureTargets(exact, textureOptions)
  const native = exact.length
    ? await engine.exportPrintMeshes({ documentId, features: exact, ...textureOptions })
    : { meshes: [] }
  if (
    native.meshes.length !== exact.length ||
    native.meshes.some(
      (mesh, index) =>
        mesh.featureId !== exact[index]?.featureId || mesh.outputRole !== exact[index]?.outputRole,
    )
  )
    throw new Error("Print mesh export returned mismatched feature bodies.")
  const nativeByKey = new Map(native.meshes.map((mesh) => [key(mesh), mesh]))
  const meshes = features.map((feature) => {
    const body = byKey.get(key(feature))
    if (!body || body.contentHash !== feature.contentHash)
      throw new Error("An export body is no longer bound to its current geometry content.")
    if (body.representation !== "triangle-mesh") {
      const mesh = nativeByKey.get(key(feature))
      if (!mesh) throw new Error("An exact export body has no native print mesh.")
      return mesh
    }
    return {
      featureId: feature.featureId,
      ...(feature.outputRole ? { outputRole: feature.outputRole } : {}),
      vertices: Array.from(body.mesh.positions),
      triangles: Array.from(body.mesh.indices),
    }
  })
  return { meshes }
}

export async function exportDocumentMeshStl(
  engine: GeometryKernelEngine,
  documentId: string,
  state: FeatureRebuildState,
  features: readonly FeatureEvaluationDependency[],
  textureOptions?: Pick<DocumentPrintMeshExportInput, "surfaceTextures" | "textureQuality">,
) {
  const collected = await collectDocumentPrintMeshes(
    engine,
    documentId,
    state,
    features,
    textureOptions,
  )
  return {
    file: writeStlMeshes(
      collected.meshes.map(({ vertices, triangles }) => ({
        vertices: [...vertices],
        triangles: [...triangles],
      })),
    ),
    bodyCount: features.length,
  }
}
