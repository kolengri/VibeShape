import {
  type AssemblyMaterializedOccurrence,
  materializeAssembly,
} from "@vibeshape/application/assembly-materialization"
import {
  type FeatureRebuildState,
  rebuildDocumentFeatures,
} from "@vibeshape/application/feature-rebuild"
import {
  canonicalJson,
  documentSnapshotSchema,
  type FeatureTypeRegistry,
  generateUuidV7,
  projectDocumentSnapshotV1ToV0,
} from "@vibeshape/domain"
import { documentSnapshotV4Schema } from "@vibeshape/domain/document-v4"
import { readMeshImportFeatureParameters } from "@vibeshape/domain/part-design-mesh-import"
import type { AssemblyNativeBody, GeometryKernelEngine } from "@vibeshape/geometry-worker/engine"
import {
  type AssemblyInspection,
  assemblyInspectionSchema,
  type InspectAssemblyInput,
} from "@vibeshape/protocol"
import type { SketchSolvePort } from "./external-sketch-references"
import {
  createDocumentFeatureContentPreparer,
  shouldPrepareDocumentFeatureContent,
} from "./extrusion-content"
import { rebuildImportedMesh } from "./mesh-source-import"
import { validateRebuildSourceMaterialization } from "./source-materialization"

async function digest(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
function nativeKey(featureId: string, contentHash: string) {
  return `${featureId}:${contentHash}`
}
function overlap(left: AssemblyMaterializedOccurrence, right: AssemblyMaterializedOccurrence) {
  return [0, 1, 2].every(
    (axis) =>
      (left.bounds.max[axis] ?? -Infinity) > (right.bounds.min[axis] ?? Infinity) &&
      (right.bounds.max[axis] ?? -Infinity) > (left.bounds.min[axis] ?? Infinity),
  )
}
async function inspectPair(
  engine: GeometryKernelEngine,
  pair: InspectAssemblyInput["interferencePairs"][number],
  left: readonly AssemblyMaterializedOccurrence[],
  right: readonly AssemblyMaterializedOccurrence[],
  nativeContexts: ReadonlyMap<string, string>,
): Promise<AssemblyInspection["interference"][number]> {
  if (!left.some((a) => right.some((b) => overlap(a, b))))
    return { ...pair, status: "clear", volume: 0, solidCount: 0 }
  if ([...left, ...right].some((source) => source.representation === "triangle-mesh"))
    return { ...pair, status: "unsupported-mesh", volume: 0, solidCount: 0 }
  if (!engine.inspectAssemblyInterference)
    throw new Error("Exact assembly interference is unavailable.")
  const metrics = await engine.inspectAssemblyInterference(
    assemblyNativeBodies(left, nativeContexts),
    assemblyNativeBodies(right, nativeContexts),
  )
  return { ...pair, ...metrics, status: metrics.volume > 0 ? "interference" : "clear" }
}

async function inspectPairs(
  engine: GeometryKernelEngine,
  input: InspectAssemblyInput,
  occurrences: readonly AssemblyMaterializedOccurrence[],
  nativeContexts: ReadonlyMap<string, string>,
): Promise<AssemblyInspection["interference"]> {
  const instances = new Map<string, AssemblyMaterializedOccurrence[]>()
  for (const occurrence of occurrences) {
    const list = instances.get(occurrence.instanceId) ?? []
    list.push(occurrence)
    instances.set(occurrence.instanceId, list)
  }
  const result: AssemblyInspection["interference"] = []

  for (const pair of input.interferencePairs) {
    const left = instances.get(pair.leftInstanceId),
      right = instances.get(pair.rightInstanceId)
    if (!left || !right)
      throw new Error("Interference selections must reference current assembly instances.")
    result.push(await inspectPair(engine, pair, left, right, nativeContexts))
  }
  return result
}

export function assemblyNativeBodies(
  sources: readonly AssemblyMaterializedOccurrence[],
  nativeContexts: ReadonlyMap<string, string>,
): AssemblyNativeBody[] {
  return sources.map((source) => {
    const documentId = nativeContexts.get(
      nativeKey(source.geometry.featureId, source.geometry.contentHash),
    )
    if (!documentId) throw new Error("A verified pinned native source is unavailable.")
    return {
      documentId,
      featureId: source.selectedBody.featureId,
      contentHash: source.geometry.contentHash,
      outputRole: source.selectedBody.outputRole,
      pose: {
        translation: [...source.geometryFrame.translation],
        quaternion: [...source.geometryFrame.quaternion],
      },
    }
  })
}
export type AssemblyRuntimeAction<T> = (
  occurrences: readonly AssemblyMaterializedOccurrence[],
  nativeContexts: ReadonlyMap<string, string>,
) => T | Promise<T>

/** Rebuilds frozen sources under disposable cache identities without changing their authored UUIDs. */
export async function withMaterializedAssemblyRuntime<T>(
  engine: GeometryKernelEngine,
  registry: FeatureTypeRegistry,
  solveSketch: SketchSolvePort | null,
  input: InspectAssemblyInput,
  identity: { documentId: string; revision: number; generation: number },
  action: AssemblyRuntimeAction<T>,
): Promise<T> {
  const authority = documentSnapshotV4Schema.parse(JSON.parse(input.authorityJson))
  if (authority.id !== identity.documentId || authority.revision !== identity.revision)
    throw new Error("The assembly source authority is stale.")
  const metadata = await engine.initialize()
  const aliases = new Set<string>()
  const nativeContexts = new Map<string, string>()
  const materials = new Map(input.sourceAssets.map((material) => [material.asset.id, material]))
  let output: Readonly<{ value: T }> | null = null
  let failed = false
  let failure: unknown
  try {
    const materialized = await materializeAssembly({
      document: authority,
      meshPolicy: input.mesh,
      contentEnvironment: metadata.featureContentEnvironment,
      sha256: digest,
      readSourceBytes: async (asset) => {
        const material = materials.get(asset.id)
        if (!material || canonicalJson(material.asset) !== canonicalJson(asset)) return null
        return material.bytes.slice()
      },
      rebuildPinnedModel: async (snapshot, sourceAssets): Promise<FeatureRebuildState> => {
        const projection = projectDocumentSnapshotV1ToV0(snapshot)
        if (!projection.ok) throw new Error(projection.diagnostic.message)
        const alias = generateUuidV7({
          timestampMs: Date.now(),
          randomBytes: crypto.getRandomValues(new Uint8Array(10)),
        })
        aliases.add(alias)
        const document = documentSnapshotSchema.parse({ ...projection.snapshot, id: alias })
        await validateRebuildSourceMaterialization(document, sourceAssets)
        const rebuilt = await rebuildDocumentFeatures({
          document,
          generation: identity.generation,
          registry,
          environment: metadata.featureContentEnvironment,
          mesh: input.mesh,
          hash: digest,
          prepareFeatureContent: createDocumentFeatureContentPreparer(
            solveSketch,
            new Map(),
            engine.sectionPlanarFace?.bind(engine),
            new Map(),
          ),
          shouldPrepareFeatureContent: shouldPrepareDocumentFeatureContent,
          evaluateGeometry: async (evaluation) => {
            const feature = document.features.find(({ id }) => id === evaluation.featureId)
            const material = sourceAssets.find(
              ({ asset }) => asset.id === feature?.parameters.sourceAssetId,
            )
            if (feature && readMeshImportFeatureParameters(feature)) {
              return {
                ok: true,
                geometry: await rebuildImportedMesh(
                  evaluation.content.feature.parameters,
                  material,
                  metadata,
                ),
              }
            }
            const result = await engine.evaluateFeature(
              { ...evaluation, documentId: alias, dependencies: [...evaluation.dependencies] },
              () => {},
              material,
            )
            if (!result.ok) return { ok: false, diagnosticCode: result.diagnostic.code }
            return { ok: true, geometry: result.result }
          },
        })
        if (!rebuilt.ok) throw new Error(rebuilt.diagnostic.message)
        for (const geometry of rebuilt.geometry)
          nativeContexts.set(nativeKey(geometry.featureId, geometry.contentHash), alias)
        return { ...rebuilt, documentId: snapshot.id }
      },
    })
    if (!materialized.ok) throw new Error(materialized.message)
    output = { value: await action(materialized.occurrences, nativeContexts) }
  } catch (error) {
    failed = true
    failure = error
  }
  const errors: unknown[] = []
  for (const alias of aliases) {
    try {
      engine.disposeDocument(alias)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length)
    throw new AggregateError(
      [...(failed ? [failure] : []), ...errors],
      "Assembly operation could not dispose every derived native scope.",
    )
  if (failed) throw failure
  if (!output) throw new Error("Assembly operation produced no result.")
  return output.value
}

export async function inspectAssemblyRuntime(
  engine: GeometryKernelEngine,
  registry: FeatureTypeRegistry,
  solveSketch: SketchSolvePort | null,
  input: InspectAssemblyInput,
  identity: { documentId: string; revision: number; generation: number },
): Promise<AssemblyInspection> {
  return withMaterializedAssemblyRuntime(
    engine,
    registry,
    solveSketch,
    input,
    identity,
    async (occurrences, nativeContexts) => {
      const interference = await inspectPairs(engine, input, occurrences, nativeContexts)
      return assemblyInspectionSchema.parse({
        occurrences: occurrences.map(({ geometry, ...occurrence }) => ({
          ...occurrence,
          contentHash: geometry.contentHash,
        })),
        interference,
      })
    },
  )
}
